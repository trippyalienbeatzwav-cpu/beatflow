// Audio worker (worker_threads). CPU-heavy jobs run here so the HTTP thread never blocks:
//   master   render (catalog synth) or decode (uploaded WAV/AIFF) → WAV 24-bit | AIFF 24-bit | MP3 320
//   stems    per-instrument WAVs (synth buses, sample-aligned with the master) → ZIP
//   pack     sample pack built from a render: loops and one-shots → ZIP
//   release  every track of a release in one format → ZIP
//   ingest   analyse an uploaded master (STFT waveform, BPM/grid, key, sections) → preview MP3 + analysis files
// Every output is written to a temp path and renamed, so a crash never leaves a half file in the cache.
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import "../../../js/music/dsp.js";
import "../../../js/music/synth.js";
import { decodeAudio, encodeWav, encodeAiff, encodeMp3, clip } from "./codec.js";
import { ZipWriter } from "./zip.js";

const D = globalThis.TBDSP, SY = globalThis.TBSynth;
const strip = (x) => Math.round(x * 1000) / 1000;

/** The synth input for a catalog spec (tracks carry their family; beats and packs map genre → family). */
export function synthInput(spec) {
  if (spec.kind === "track") return spec;
  return { id: spec.id, title: spec.title, bpm: spec.bpm, key: spec.key || "A min", family: SY.BEAT_FAMILIES[spec.genre] ?? "four", energy: spec.energy ?? 7,
    duration: spec.duration ?? 180, intro: "8-bar intro", outro: "8-bar outro" };
}
function source(job) {
  if (job.spec) { const r = SY.renderTrack(synthInput(job.spec)); return { channels: r.channels, sampleRate: r.sampleRate, render: r }; }
  const a = decodeAudio(fs.readFileSync(job.file));
  return { channels: a.channels, sampleRate: a.sampleRate };
}
function encode(format, ch, sr) {
  if (format === "WAV") return encodeWav(ch, sr, 24);
  if (format === "AIFF") return encodeAiff(ch, sr, 24);
  if (format === "MP3") return encodeMp3(ch, sr, 320);
  throw new Error(`Unknown format ${format}`);
}
const EXT = { WAV: "wav", AIFF: "aiff", MP3: "mp3" };
function atomic(out, write) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
  try { write(tmp); fs.renameSync(tmp, out); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return fs.statSync(out).size;
}

/** Stems of a synth render: raw buses scaled by the master's gain, so they sum to the master. */
function synthStems(spec) {
  const input = synthInput(spec);
  const master = SY.renderTrack(input, { raw: true });
  return { master, stems: master.stems.map((name) => ({ name, render: SY.renderTrack(input, { only: name, raw: true, gain: master.gain }) })) };
}

/** What a sample pack contains, by type (also used by the seed to describe it truthfully). */
export function packPlan(type) {
  const loops = ["Drums", "Kick", "Snare & Clap", "Hi-hats", "Bass", "Keys & Synths", "Full Mix"];
  if (type === "samples") return { loops: ["Drums", "Full Mix"], oneShots: { "Kick": 4, "Snare & Clap": 4, "Hi-hats": 4, "Bass": 4 } };
  if (type === "loops") return { loops, oneShots: {} };
  if (type === "production") return { loops, oneShots: { "Kick": 2, "Snare & Clap": 2, "Bass": 2 } };
  return { stems: true, loops: [], oneShots: {} };
}
export function packDescription(type, bpm) {
  const p = packPlan(type);
  if (p.stems) return "Full-length instrument stems · 24-bit / 48 kHz WAV";
  const shots = Object.values(p.oneShots).reduce((a, b) => a + b, 0);
  return [`${p.loops.length} eight-bar loops at ${bpm} BPM`, shots ? `${shots} one-shots` : null, "24-bit / 48 kHz WAV"].filter(Boolean).join(" · ");
}

const jobs = {
  master(job) {
    const src = source(job);
    return { bytes: atomic(job.out, (tmp) => fs.writeFileSync(tmp, encode(job.format, src.channels, src.sampleRate))) };
  },
  stems(job) {
    const { stems } = synthStems(job.spec);
    let count = 0;
    const bytes = atomic(job.out, (tmp) => {
      const z = new ZipWriter(tmp);
      for (const s of stems) { z.add(`${job.base} - ${s.name.replace(/&/g, "and")}.wav`, encodeWav(s.render.channels, s.render.sampleRate, 24)); count++; }
      if (job.readme) z.add("LICENSE.txt", Buffer.from(job.readme, "utf8"));
      return z.close();
    });
    return { bytes, entries: count };
  },
  pack(job) {
    const plan = packPlan(job.spec.type);
    const input = synthInput({ ...job.spec, duration: 150 });
    const master = SY.renderTrack(input, { raw: true });
    const sr = master.sampleRate, beat = 60 / input.bpm, bar = beat * 4;
    const drop = master.sections.find((s) => s.label === "drop");
    const t0 = drop.start, t1 = t0 + 8 * bar;
    const render = (only) => SY.renderTrack(input, { only, raw: true, gain: master.gain }).channels;
    const slice = (ch, a, b) => ch.map((c) => c.slice(Math.round(a * sr), Math.round(b * sr)));
    const mixOf = (names) => { const outs = names.filter((n) => master.stems.includes(n)).map(render); const ln = outs[0][0].length; const o = [new Float32Array(ln), new Float32Array(ln)]; for (const x of outs) for (let c = 0; c < 2; c++) for (let i = 0; i < ln; i++) o[c][i] += x[c][i]; return o; };
    const base = `${input.bpm} BPM ${input.key.replace(/\s/g, "")}`;
    let count = 0;
    const bytes = atomic(job.out, (tmp) => {
      const z = new ZipWriter(tmp);
      if (plan.stems) {
        for (const name of master.stems) { z.add(`Stems/${job.base} - ${name.replace(/&/g, "and")}.wav`, encodeWav(render(name), sr, 24)); count++; }
      }
      for (const name of plan.loops) {
        const ch = name === "Full Mix" ? master.channels : name === "Drums" ? mixOf(["Kick", "Snare & Clap", "Hi-hats", "Cymbals", "Percussion"]) : master.stems.includes(name) ? render(name) : null;
        if (!ch) continue;
        z.add(`Loops/${job.base} ${name.replace(/&/g, "and")} Loop ${base}.wav`, encodeWav(slice(ch, t0, t1), sr, 24)); count++;
      }
      for (const [name, n] of Object.entries(plan.oneShots)) {
        if (!master.stems.includes(name)) continue;
        const ch = render(name), len = name === "Bass" ? 1.2 : name === "Hi-hats" ? 0.25 : 0.6;
        for (let i = 0; i < n; i++) {
          // Onsets inside different bars of the drop (different chords → different bass notes)
          const pat = (globalThis.TBSynth.PAT[input.family] ?? {})[{ "Kick": "k", "Snare & Clap": "s", "Hi-hats": "h", "Bass": "b" }[name]];
          const step = Array.isArray(pat) && pat.length ? pat[0] : 0;
          const at = t0 + i * 2 * bar + step * (beat / 4);
          z.add(`One-Shots/${name.replace(/&/g, "and")}/${job.base} ${name.replace(/&/g, "and")} ${String(i + 1).padStart(2, "0")}.wav`, encodeWav(slice(ch, at, at + len), sr, 24)); count++;
        }
      }
      if (job.readme) z.add("LICENSE.txt", Buffer.from(job.readme, "utf8"));
      return z.close();
    });
    return { bytes, entries: count };
  },
  release(job) {
    const bytes = atomic(job.out, (tmp) => {
      const z = new ZipWriter(tmp);
      for (const t of job.tracks) { const src = t.spec ? source({ spec: t.spec }) : source({ file: t.file }); z.add(`${t.name}.${EXT[job.format]}`, encode(job.format, src.channels, src.sampleRate)); }
      if (job.readme) z.add("PURCHASE TERMS.txt", Buffer.from(job.readme, "utf8"));
      return z.close();
    });
    return { bytes, entries: job.tracks.length };
  },
  ingest(job) {
    const a = decodeAudio(fs.readFileSync(job.file));
    const sr = a.sampleRate, ch = a.channels, dur = ch[0].length / sr;
    const hop = Math.round(sr / 100);
    // A declared BPM narrows the search around it; otherwise the genre's typical range does (avoids 2:3 / octave errors)
    const bpmRange = job.bpm ? [Math.max(40, job.bpm * 0.8), Math.min(250, job.bpm * 1.25)] : job.bpmRange ?? undefined;
    const an = D.analyze(ch, sr, { hop, bpmRange });
    const overview = an.levels.find((l) => l.hop >= sr / 25) ?? an.levels.at(-1);
    // Preview window: start of the first build (else 16 bars before the first drop, else the start)
    const build = an.sections.find((s) => s.label === "build"), drop = an.sections.find((s) => s.label === "drop");
    const len = Math.min(job.previewLength ?? 90, dur);
    let start = build ? build.start : drop && an.period ? Math.max(0, drop.start - 16 * 4 * an.period) : 0;
    start = Math.max(0, Math.min(start, dur - len));
    const end = Math.min(dur, start + len);
    const mp3 = encodeMp3(clip(ch, sr, start, end, 0.5, 3), sr, 160);
    fs.mkdirSync(job.outDir, { recursive: true });
    fs.writeFileSync(path.join(job.outDir, `${job.id}.mp3`), mp3);
    fs.writeFileSync(path.join(job.outDir, `${job.id}.wf`), D.encodeLevel(overview, { id: job.id }));
    const meta = {
      id: job.id, duration: strip(dur), sampleRate: sr, channels: a.sourceChannels, bitDepth: a.bits,
      bpm: an.bpm, beatPeriod: an.period, firstBeat: strip(an.beats[0] ?? 0), beatConfidence: Math.round(an.beatConfidence * 100) / 100, gridReliable: an.beatConfidence >= 0.2,
      downbeatOffset: an.downbeatOffset, firstDownbeat: strip(an.downbeats[0] ?? 0), bars: an.downbeats.length,
      key: an.key && { name: an.key.name, camelot: an.key.camelot, confidence: Math.round(an.key.confidence * 1000) / 1000 },
      sections: an.sections.map((s) => ({ label: s.label, start: strip(s.start), end: strip(s.end), startBar: s.startBar, bars: s.bars, vocal: s.vocal })),
      cues: an.cues.map((c) => ({ ...c, time: strip(c.time) })), loop: an.loop && { start: strip(an.loop.start), end: strip(an.loop.end), bars: an.loop.bars },
      loudness: { peakDb: Math.round(an.peakDb * 10) / 10, rmsDb: Math.round(an.rmsDb * 10) / 10 },
      preview: { file: `${job.publicPrefix}/${job.id}.mp3`, start: strip(start), end: strip(end), fadeIn: 0.5, fadeOut: 3 },
      overview: { file: `${job.publicPrefix}/${job.id}.wf`, hop: overview.hop, columnsPerSecond: sr / overview.hop },
      // LAME adds 576 samples of encoder delay plus 529 of decoder delay that browsers don't strip without a LAME tag
      format: { codec: "mp3", container: "mpeg", bitrate: 160000, sampleRate: [48000, 44100, 32000].includes(sr) ? sr : sr > 44100 ? 48000 : 44100, channels: 2, clockOffset: strip(1105 / sr) },
    };
    fs.writeFileSync(path.join(job.outDir, `${job.id}.json`), JSON.stringify(meta));
    return { meta };
  },
};

parentPort?.on("message", ({ id, job }) => {
  try { parentPort.postMessage({ id, result: jobs[job.op](job) }); }
  catch (err) { parentPort.postMessage({ id, error: { message: err.message, code: err.code ?? "job_failed" } }); }
});
