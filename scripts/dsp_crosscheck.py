"""Independent NumPy re-implementation of the key measurements made by js/music/dsp.js, compared against
the JavaScript results written by scripts/dsp-crosscheck.mjs. Shares no code with the JS side.

    node scripts/dsp-crosscheck.mjs test-results/dsp-crosscheck
    python scripts/dsp_crosscheck.py test-results/dsp-crosscheck

Checks (tolerances in brackets):
  band energy shares, low 20-250 Hz / mid 250-4000 Hz / high 4-20 kHz   [0.03 absolute]
  sample peak and RMS level in dBFS                                       [0.1 dB / 0.3 dB]
  tempo from onset-strength autocorrelation                               [1 BPM, octave errors reported]
  key (Krumhansl-Schmuckler on a chromagram)                              [reported, not asserted]
Exit code 1 if any asserted check fails.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

N_FFT, HOP = 2048, 256
BANDS = {"low": (20, 250), "mid": (250, 4000), "high": (4000, 20000)}
NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        sr, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        assert width == 2, "16-bit PCM expected"
        x = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768.0
    return x.reshape(-1, ch).T, sr


def stft_power(mono, sr):
    """Hann-windowed power spectra centred on the middle of each hop (zero padded at the edges)."""
    n_cols = int(np.ceil(len(mono) / HOP))
    pad = np.concatenate([np.zeros(N_FFT), mono, np.zeros(N_FFT)])
    win = np.hanning(N_FFT + 1)[:-1]  # periodic Hann
    centres = np.arange(n_cols) * HOP + HOP // 2 + N_FFT
    idx = centres[:, None] - N_FFT // 2 + np.arange(N_FFT)[None, :]
    frames = pad[idx] * win
    return np.abs(np.fft.rfft(frames, axis=1)) ** 2


def band_shares(power, sr):
    freqs = np.fft.rfftfreq(N_FFT, 1 / sr)
    e = {k: power[:, (freqs >= lo) & (freqs < hi)].sum() for k, (lo, hi) in BANDS.items()}
    tot = sum(e.values()) or 1.0
    return {k: v / tot for k, v in e.items()}


def levels(ch):
    mono = ch.mean(axis=0)
    peak = np.abs(ch).max()
    rms = np.sqrt(np.mean(mono ** 2))
    db = lambda v: 20 * np.log10(max(v, 1e-10))
    return db(peak), db(rms)


def tempo(power, sr, lo=70, hi=190):
    """Onset strength = half-wave-rectified log-spectral flux; tempo = best autocorrelation lag,
    scored with its multiples (comb) to prefer the beat level over sub-divisions."""
    mag = np.log1p(1000 * np.sqrt(power / (N_FFT ** 2 / 4)))
    flux = np.maximum(0, np.diff(mag, axis=0)).mean(axis=1)
    flux = flux - np.convolve(flux, np.ones(16) / 16, mode="same")
    flux = np.maximum(flux, 0)
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    fps = sr / HOP
    best, best_score = None, -1
    for bpm in np.arange(lo, hi, 0.05):
        lag = 60 * fps / bpm
        score = sum(np.interp(lag * m, np.arange(len(ac)), ac) / m for m in (1, 2, 4))
        if score > best_score:
            best, best_score = bpm, score
    return float(best)


def key(ch, sr):
    mono = ch.mean(axis=0)
    power = stft_power(mono, sr)
    freqs = np.fft.rfftfreq(N_FFT, 1 / sr)
    sel = (freqs >= 55) & (freqs <= 2000)
    pcs = (np.round(12 * np.log2(freqs[sel] / 440.0)) + 9) % 12
    chroma = np.array([np.sqrt(power[:, sel][:, pcs == p]).sum() for p in range(12)])
    best = max(((np.corrcoef(np.roll(prof, s), chroma)[0, 1], f"{NOTES[s]} {mode}")
                for s in range(12) for prof, mode in ((MAJOR, "maj"), (MINOR, "min"))))
    return best[1]


def main(folder):
    folder = Path(folder)
    js = json.loads((folder / "js.json").read_text(encoding="utf-8"))
    failures, rows = [], []
    for name, r in js.items():
        ch, sr = read_wav(folder / r["file"])
        power = stft_power(ch.mean(axis=0), sr)
        sh = band_shares(power, sr)
        peak, rms = levels(ch)
        py_bpm = tempo(power, sr) if r["expectBpm"] else None
        py_key = key(ch, sr)
        d_share = max(abs(sh[k] - r["share"][k]) for k in sh)
        checks = {
            "bands": d_share <= 0.03,
            "peak": abs(peak - r["peakDb"]) <= 0.1,
            "rms": abs(rms - r["rmsDb"]) <= 0.3,
        }
        if r["expectBpm"]:
            checks["bpm_js"] = r["bpm"] is not None and abs(r["bpm"] - r["expectBpm"]) <= 1
            checks["bpm_py"] = abs(py_bpm - r["expectBpm"]) <= 1 or abs(py_bpm * 2 - r["expectBpm"]) <= 1 or abs(py_bpm / 2 - r["expectBpm"]) <= 1
        for k, ok in checks.items():
            if not ok:
                failures.append(f"{name}: {k}")
        rows.append((name, sh, r["share"], d_share, peak, r["peakDb"], rms, r["rmsDb"], r["expectBpm"], r["bpm"], py_bpm, r["key"], py_key, checks))

    print(f"{'track':20} {'low/mid/high (numpy)':22} {'(js)':22} {'Δmax':>6} {'peak np/js':>13} {'rms np/js':>13} {'bpm true/js/np':>18}  key js / np")
    for (name, sh, jsh, d, pk, jpk, rm, jrm, tb, jb, pb, jk, pk2, checks) in rows:
        f = lambda s: "/".join(f"{s[k]:.3f}" for k in ("low", "mid", "high"))
        bpm = f"{tb or '-'}/{jb if jb is None else round(jb, 2)}/{pb if pb is None else round(pb, 2)}"
        mark = "OK " if all(checks.values()) else "FAIL"
        print(f"{name:20} {f(sh):22} {f(jsh):22} {d:6.3f} {pk:6.2f}/{jpk:6.2f} {rm:6.2f}/{jrm:6.2f} {bpm:>18}  {jk} / {pk2}  {mark}")
    for (name, *_rest) in rows:
        if js[name].get("bpmUnguided"):
            print(f"note: {name} without a genre range the JS tracker picks {js[name]['bpmUnguided']:.2f} BPM (metrical error); the server passes the genre range.")
    agree = sum(1 for r in rows if r[11] == r[12])
    print(f"\nkey agreement js vs numpy: {agree}/{len(rows)} (reported only; synthetic material has weak tonal content)")
    if failures:
        print("FAILED: " + ", ".join(failures))
        sys.exit(1)
    print("All asserted checks passed.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "test-results/dsp-crosscheck")
