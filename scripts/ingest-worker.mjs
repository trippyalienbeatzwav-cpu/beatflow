// Worker thread for scripts/render-catalog.mjs: render one master, analyse it, write the preview slice as WAV.
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import "../js/music/dsp.js";
import "../js/music/synth.js";

const D = globalThis.TBDSP, S = globalThis.TBSynth;
const strip = (x) => Math.round(x * 1000) / 1000;

function writeWav16(file, ch, sr, from, to) {
  const a = Math.round(from * sr), n = Math.round(to * sr) - a, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][a + i])) * 32767), 44 + i * 4 + c * 2);
  fs.writeFileSync(file, buf);
}

parentPort.on("message", ({ meta, preview, wavPath, dir = { preview: "previews", analysis: "analysis" } }) => {
  const t0 = performance.now();
  const r = S.renderTrack(meta);
  const sr = r.sampleRate, ch = r.channels;
  const t1 = performance.now();
  const a = D.analyze(ch, sr, { hop: 480, bpmRange: preview.fromStart ? [meta.bpm * 0.92, meta.bpm * 1.08] : r.range });
  const t2 = performance.now();
  const overview = a.levels.find((l) => l.hop >= 1920) ?? a.levels.at(-1);
  // Store preview policy: start on the downbeat that opens the first build (else 16 bars before the first drop)
  const build = a.sections.find((s) => s.label === "build"), drop = a.sections.find((s) => s.label === "drop");
  const dur = ch[0].length / sr;
  // Beats and pack demos preview from the top (artists judge the whole instrumental); club tracks from the build
  let start = preview.fromStart ? 0 : build ? build.start : drop && a.period ? Math.max(0, drop.start - 16 * 4 * a.period) : 0;
  start = Math.max(0, Math.min(start, dur - preview.length));
  const end = Math.min(dur, start + preview.length);
  writeWav16(wavPath, ch, sr, start, end);
  parentPort.postMessage({
    id: meta.id,
    wf: D.encodeLevel(overview, { id: meta.id }),
    meta: {
      id: meta.id, duration: strip(dur), sampleRate: sr, channels: 2,
      bpm: a.bpm, beatPeriod: a.period, firstBeat: strip(a.beats[0] ?? 0), beatConfidence: Math.round(a.beatConfidence * 100) / 100,
      // Below this confidence there is no clear beat (ambient, beatless): the store shows the label BPM and hides the grid
      gridReliable: a.beatConfidence >= 0.2,
      downbeatOffset: a.downbeatOffset, firstDownbeat: strip(a.downbeats[0] ?? 0), bars: a.downbeats.length,
      key: a.key && { name: a.key.name, camelot: a.key.camelot, confidence: Math.round(a.key.confidence * 1000) / 1000 },
      sections: a.sections.map((s) => ({ label: s.label, start: strip(s.start), end: strip(s.end), startBar: s.startBar, bars: s.bars, vocal: s.vocal })),
      cues: a.cues.map((c) => ({ ...c, time: strip(c.time) })), loop: a.loop && { start: strip(a.loop.start), end: strip(a.loop.end), bars: a.loop.bars },
      loudness: { peakDb: Math.round(a.peakDb * 10) / 10, rmsDb: Math.round(a.rmsDb * 10) / 10 },
      preview: { file: dir.preview + "/" + meta.id + ".opus", start: strip(start), end: strip(end), fadeIn: preview.fadeIn, fadeOut: preview.fadeOut },
      overview: { file: dir.analysis + "/" + meta.id + ".wf", hop: overview.hop, columnsPerSecond: sr / overview.hop },
      format: { codec: "opus", container: "ogg", bitrate: preview.bitrate, sampleRate: 48000, channels: 2 },
    },
    truth: { sections: r.sections.map((s) => ({ label: s.label, startBar: s.startBar, bars: s.bars, start: strip(s.start) })), firstBeat: r.firstBeat },
    timings: { render: Math.round(t1 - t0), analyse: Math.round(t2 - t1) },
  });
});
