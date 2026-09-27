/* Analysis worker: runs the STFT waveform analysis off the main thread and returns typed arrays. */
importScripts("dsp.js");
self.onmessage = (e) => {
  const { id, channels, sr, opts } = e.data;
  try {
    const hop = opts.hop ?? 256;
    let result;
    if (opts.full) {
      // Local file analysis (Player Lab): everything, including beats, key and sections
      const a = TBDSP.analyze(channels, sr, { hop, bpmRange: opts.bpmRange ?? undefined });
      result = { ...a, levels: a.levels.map(pack), duration: channels[0].length / sr };
    } else {
      const cols = TBDSP.columns(channels, sr, { hop });
      const grid = TBDSP.detectBeats(cols);
      result = { levels: TBDSP.mipChain(cols).map(pack), offset: opts.offset ?? 0, sr, duration: channels[0].length / sr, bpm: grid?.bpm ?? null, firstBeat: grid ? grid.beats[0] + (opts.offset ?? 0) : null, beatConfidence: grid?.confidence ?? 0 };
    }
    const transfer = [];
    result.levels.forEach((l) => Object.values(l).forEach((v) => v instanceof Float32Array && transfer.push(v.buffer)));
    delete result.onset;
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
function pack(l) {
  const o = { n: l.n, hop: l.hop, sr: l.sr, from: l.from };
  for (const k of ["maxL", "minL", "maxR", "minR", "rms", "low", "lowMid", "highMid", "high", "flux", "lowFlux"]) o[k] = l[k];
  return o;
}
