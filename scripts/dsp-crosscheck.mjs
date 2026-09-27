// Independent cross-check of the audio analysis (js/music/dsp.js) against a separate NumPy implementation
// (scripts/dsp_crosscheck.py). This script renders the reference fixtures to 16-bit WAV, decodes the WAV back
// (so both sides analyse identical samples), runs the app's DSP and writes the results next to the files.
//   node scripts/dsp-crosscheck.mjs <outDir>   then   python scripts/dsp_crosscheck.py <outDir>
import fs from "node:fs";
import path from "node:path";
import "../js/music/dsp.js";
import * as A from "../tests/fixtures/audio.js";
import { decodeAudio } from "../server/lib/audio/codec.js";

const D = globalThis.TBDSP;
const out = path.resolve(process.argv[2] ?? "test-results/dsp-crosscheck");
fs.mkdirSync(out, { recursive: true });

const tracks = {
  A_kick_bass: A.trackA(), B_vocal: A.trackB(), C_synths: A.trackC(), D_hats: A.trackD(), E_full_mix: A.trackE(), F_breakdown: A.trackF(), G_arranged: A.trackG(),
  tempo_100: A.tempoClip(100), tempo_128: A.tempoClip(128), tempo_140_halftime: A.tempoClip(140, "halftime"), tempo_174_dnb: A.tempoClip(174, "dnb"),
};
// Tempo search range as the server uses it for uploads: the genre's typical range widened 10% (drum & bass: 170–176)
const RANGES = { tempo_174_dnb: [153, 194] };
const results = {};
for (const [name, t] of Object.entries(tracks)) {
  const file = path.join(out, `${name}.wav`);
  A.writeWav(file, t.ch);
  const { channels, sampleRate } = decodeAudio(fs.readFileSync(file));
  const c = D.columns(channels, sampleRate);
  const e = { low: 0, lowMid: 0, highMid: 0, high: 0 };
  for (let i = 0; i < c.n; i++) for (const k in e) e[k] += c[k][i];
  const tot = e.low + e.lowMid + e.highMid + e.high || 1;
  const a = D.analyze(channels, sampleRate, RANGES[name] ? { bpmRange: RANGES[name] } : {});
  const unguided = RANGES[name] ? D.analyze(channels, sampleRate, { withKey: false }).bpm : null;
  results[name] = {
    file: path.basename(file), expectBpm: t.bpm ?? null,
    share: { low: e.low / tot, mid: (e.lowMid + e.highMid) / tot, high: e.high / tot },
    peakDb: a.peakDb, rmsDb: a.rmsDb, bpm: a.bpm, bpmUnguided: unguided, beatConfidence: a.beatConfidence, key: a.key?.name ?? null,
  };
}
fs.writeFileSync(path.join(out, "js.json"), JSON.stringify(results, null, 2));
console.log(`wrote ${Object.keys(results).length} WAVs and js.json to ${out}`);
