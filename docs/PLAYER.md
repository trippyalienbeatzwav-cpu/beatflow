# Electronic Music Store preview player

The Electronic Music Store plays real audio previews. Its waveforms are drawn from a frequency analysis of that audio. Nothing is random or decorative.

## Colour language

| Colour | Band | What it shows |
|---|---|---|
| Red | 20–250 Hz | Kick, sub, bass |
| Green → yellow → orange | 250 Hz–4 kHz | Vocals, synths, melodies, snare body. Green = energy in 250 Hz–1 kHz, orange = presence in 1–4 kHz |
| Blue | 4–20 kHz | Hats, cymbals, shakers, air |

The colour of each waveform column comes only from band energies measured in that column (see `bandShares` in `js/music/dsp.js`). There is no gradient across time. Two views are available: **3-Band** draws each band's envelope at its measured size, with the largest band behind. **Blend** draws one energy-weighted colour per column.

## Pipeline

```
master (48 kHz stereo)
  └─ scripts/render-catalog.mjs  (Node worker threads)
       ├─ STFT (2048-pt FFT, Hann, hop 480) → per-column true peaks L/R, RMS, 4 band energies, spectral flux
       ├─ beats: onset envelope → autocorrelation tempo → comb phase → least-squares grid; downbeats; confidence
       ├─ structure: 4-bar blocks → intro / build / drop / breakdown / bass / outro / silence
       ├─ key (estimate): HPSS + chroma + Krumhansl–Schmuckler
       ├─ preview window: first build-up, up to 90 s
       ├─ assets/audio/analysis/<id>.wf   compact binary overview (TBWF, 25 columns/s)
       ├─ assets/audio/analysis/<id>.json BPM, grid, sections, cues, loudness, preview window
       └─ assets/audio/previews/<id>.opus  Opus 64 kb/s clip (WebCodecs in headless Edge, custom Ogg muxer)

browser
  ├─ BF.previewEngine  <audio> streams the clip. audio.currentTime is the ONLY clock:
  │                    track position = clipStart + currentTime. Fades, loop and preview end are
  │                    enforced against it every animation frame
  ├─ BF.trackDetail    decodes the clip and runs the same analysis in a Worker (hop 256), cached in IndexedDB
  └─ BF.Wave           canvas renderer (overview + zoomed detail, beat/bar grid, cues, loop, stereo)
```

The catalog masters are **synthesised** by `js/music/synth.js` (deterministic, original sound design), because the project ships no third-party music. The same pipeline runs unchanged on real masters. Replace the render step with decoding the label's uploaded WAV/AIFF.

## Using the player

- **Player bar**: mini overview waveform (tap or drag to seek; a vertical swipe scrolls the page and doesn't seek), current and remaining time, and a **Deck** button.
- **Deck**: zoomed detail waveform with a fixed centre playhead (drag to jog, wheel to zoom), overview with the preview window highlighted, structure bar, cues A (start) / B (drop) / C (breakdown), 4/8/16-bar loops, 3-Band / Blend / Stereo views, full track info, and Buy track / Buy release / Download (when owned) / favourite / crate / share.
- **Keys** (deck focused): Space play · ←/→ one beat · Shift+←/→ one bar · PageUp/PageDown 16 beats · +/− zoom · L loop · 1–3 cues · M mute · Home/End preview start/end · Esc close.
- **Tracks without a reliable beat** (ambient, beat confidence < 0.2): the grid, loops and structure markers are hidden, and the label BPM is shown.

## Preview settings

`BF.PREVIEW_CONFIG` = `{ maxLength, startOffset, fadeIn, fadeOut }`. It can be edited in the Player Lab and is saved per device. The clip is cut at ingest, so the store can start later inside it, shorten it and change the fades, but it can't play outside it. A server-side policy should replace the per-device setting when labels need per-release control.

## Player Lab: `#/electronic/player-lab`

- **Reference tracks A–G**: synthesised with known content, encoded to Opus like the catalog, then decoded and analysed in the browser. Each result is checked against ground truth: band shares, dominant-colour share of canvas pixels, BPM, drop position and section order.
  - A: kick + bass → red
  - B: vocal → mid colours
  - C: synths → mid colours
  - D: hats → blue
  - E: full mix → all three
  - F: breakdown → low energy, then silence
  - G: arranged track
- **Analyse your own track**: decoded and analysed on the device, never uploaded.
- **Store preview settings.**

## Verification

- `tests/unit/dsp.test.js` covers band mapping, true-peak amplitude, tracks A–F, BPM at 90–174 BPM, the beat phase and G's structure, in Node.
- `tests/e2e/player.test.js` runs in a real browser. It covers:
  - Player Lab, all passing.
  - Clock sync.
  - Seek and clamping.
  - Beat-step keys, zoom, loop wrap and cue jump.
  - Fade gains and preview-end enforcement.
  - Ownership vs purchase, and cart.
  - Configurable window.
  - Layout at 320–1920 px, touch-sized controls, and touch swipe.

Latest catalog ingest (57 tracks, `assets/audio/qa-report.json`):

| Check | Result |
|---|---|
| BPM exact (the grid's BPM rounds to the label BPM) | 53 of 57. The misses are the ambient tracks, which have no beat to detect |
| Drop within 1 bar of the arrangement | 52 of 57 |
| Opus clip alignment | ≤ 4 samples |
| Key | 25 of 57 exact. The detector is an estimate; the label's key is shown as the authoritative value |

## Known limits

- The key detector is about 50% accurate on this catalog. The deck labels it "analysis" next to the label key.
- The Beats Store (`#/beats`) still plays the synthesised sketch engine, with decorative peak bars generated from each beat's ID. There are no uploaded beat audio files to analyse. Once beat audio exists, run it through the same ingest.
- High-resolution waveforms cover the preview clip only. The full track is shown at overview resolution.
