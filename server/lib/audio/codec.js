// PCM codecs in plain JavaScript (no native dependencies):
//   decodeAudio(buf)  WAV (PCM 8/16/24/32-bit int, 32/64-bit float, WAVE_FORMAT_EXTENSIBLE) and AIFF/AIFC (NONE, sowt, fl32)
//   encodeWav / encodeAiff  24-bit (or 16-bit) interleaved PCM
//   encodeMp3  MPEG-1 Layer III via lamejs (CBR)
// Inputs are validated strictly: uploaded masters come from users.
import lamejs from "@breezystack/lamejs";

export class AudioFormatError extends Error { constructor(msg) { super(msg); this.code = "invalid_audio"; } }
const fail = (m) => { throw new AudioFormatError(m); };

/** 80-bit IEEE extended (AIFF sample rate). */
function readExtended(buf, o) {
  const exp = buf.readUInt16BE(o) & 0x7fff, hi = buf.readUInt32BE(o + 2), lo = buf.readUInt32BE(o + 6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}
function writeExtended(buf, o, v) {
  let exp = Math.floor(Math.log2(v)); const mant = v / 2 ** exp;
  exp += 16383;
  buf.writeUInt16BE(exp, o);
  const m = mant * 2 ** 63;
  buf.writeUInt32BE(Math.floor(m / 2 ** 32) >>> 0, o + 2);
  buf.writeUInt32BE(Math.floor(m % 2 ** 32) >>> 0, o + 6);
}

/** Header-only inspection (cheap validation before accepting an upload). */
export function probeAudio(head) {
  const s = (a, b) => head.subarray(a, b).toString("latin1");
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "wav";
  if (s(0, 4) === "FORM" && (s(8, 12) === "AIFF" || s(8, 12) === "AIFC")) return "aiff";
  return null;
}

export function decodeAudio(buf, { maxSeconds = 30 * 60 } = {}) {
  const kind = probeAudio(buf);
  if (kind === "wav") return decodeWav(buf, maxSeconds);
  if (kind === "aiff") return decodeAiff(buf, maxSeconds);
  fail("Masters must be WAV or AIFF files.");
}

function checkFmt({ channels, sampleRate, bits, frames }, maxSeconds) {
  if (!(channels >= 1 && channels <= 8)) fail(`Unsupported channel count (${channels}).`);
  if (!(sampleRate >= 22050 && sampleRate <= 192000)) fail(`Unsupported sample rate (${sampleRate} Hz). Use 44.1–192 kHz.`);
  if (![8, 16, 24, 32, 64].includes(bits)) fail(`Unsupported bit depth (${bits}).`);
  if (frames < sampleRate * 1) fail("The audio is shorter than one second.");
  if (frames > sampleRate * maxSeconds) fail(`The audio is longer than ${maxSeconds / 60} minutes.`);
}

function deinterleave(buf, off, frames, ch, bits, float, bigEndian) {
  const out = Array.from({ length: Math.min(ch, 2) }, () => new Float32Array(frames));
  const bps = bits / 8, stride = bps * ch;
  const rd = bits === 8 ? (o) => (buf[o] - 128) / 128
    : bits === 16 ? (bigEndian ? (o) => buf.readInt16BE(o) / 32768 : (o) => buf.readInt16LE(o) / 32768)
    : bits === 24 ? (bigEndian ? (o) => buf.readIntBE(o, 3) / 8388608 : (o) => buf.readIntLE(o, 3) / 8388608)
    : bits === 32 && float ? (bigEndian ? (o) => buf.readFloatBE(o) : (o) => buf.readFloatLE(o))
    : bits === 32 ? (bigEndian ? (o) => buf.readInt32BE(o) / 2147483648 : (o) => buf.readInt32LE(o) / 2147483648)
    : (bigEndian ? (o) => buf.readDoubleBE(o) : (o) => buf.readDoubleLE(o));
  for (let i = 0; i < frames; i++) {
    const base = off + i * stride;
    if (ch === 1) { const v = rd(base); out[0][i] = v; }
    else { out[0][i] = rd(base); out[1][i] = rd(base + bps); }   // >2 channels: first pair (front L/R)
  }
  if (ch === 1) out.push(out[0]);
  for (const c of out) for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0;
  return out;
}

function decodeWav(buf, maxSeconds) {
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.subarray(o, o + 4).toString("latin1"), size = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      if (size < 16) fail("Malformed WAV header.");
      let tag = buf.readUInt16LE(o + 8);
      if (tag === 0xfffe && size >= 40) tag = buf.readUInt16LE(o + 32);   // extensible: sub-format GUID
      fmt = { tag, channels: buf.readUInt16LE(o + 10), sampleRate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    } else if (id === "data") { data = { off: o + 8, size: Math.min(size, buf.length - o - 8) }; break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) fail("The WAV file has no audio data.");
  if (fmt.tag !== 1 && fmt.tag !== 3) fail("Only uncompressed PCM or float WAV files are supported.");
  const float = fmt.tag === 3;
  if (float && fmt.bits !== 32 && fmt.bits !== 64) fail("Unsupported float WAV.");
  const frames = Math.floor(data.size / (fmt.bits / 8) / fmt.channels);
  checkFmt({ ...fmt, frames }, maxSeconds);
  return { sampleRate: fmt.sampleRate, channels: deinterleave(buf, data.off, frames, fmt.channels, fmt.bits, float, false), sourceChannels: fmt.channels, bits: fmt.bits, format: "wav" };
}

function decodeAiff(buf, maxSeconds) {
  const aifc = buf.subarray(8, 12).toString("latin1") === "AIFC";
  let o = 12, comm = null, ssnd = null;
  while (o + 8 <= buf.length) {
    const id = buf.subarray(o, o + 4).toString("latin1"), size = buf.readUInt32BE(o + 4);
    if (id === "COMM") {
      comm = { channels: buf.readUInt16BE(o + 8), frames: buf.readUInt32BE(o + 10), bits: buf.readUInt16BE(o + 14), sampleRate: Math.round(readExtended(buf, o + 16)), comp: aifc ? buf.subarray(o + 26, o + 30).toString("latin1") : "NONE" };
    } else if (id === "SSND") { const offset = buf.readUInt32BE(o + 8); ssnd = { off: o + 16 + offset, size: size - 8 - offset }; }
    o += 8 + size + (size & 1);
  }
  if (!comm || !ssnd) fail("The AIFF file has no audio data.");
  if (!["NONE", "sowt", "fl32", "FL32"].includes(comm.comp)) fail(`Compressed AIFF (${comm.comp}) isn’t supported.`);
  const float = comm.comp.toLowerCase() === "fl32";
  const frames = Math.min(comm.frames, Math.floor(Math.min(ssnd.size, buf.length - ssnd.off) / (comm.bits / 8) / comm.channels));
  checkFmt({ ...comm, frames }, maxSeconds);
  return { sampleRate: comm.sampleRate, channels: deinterleave(buf, ssnd.off, frames, comm.channels, float ? 32 : comm.bits, float, comm.comp !== "sowt"), sourceChannels: comm.channels, bits: comm.bits, format: "aiff" };
}

const clamp = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
function pcm(channels, bits, bigEndian) {
  const n = channels[0].length, ch = channels.length, bps = bits / 8;
  const out = Buffer.alloc(n * ch * bps);
  const max = bits === 24 ? 8388607 : 32767;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.round(clamp(channels[c][i]) * max), o = (i * ch + c) * bps;
    if (bits === 24) bigEndian ? out.writeIntBE(v, o, 3) : out.writeIntLE(v, o, 3);
    else bigEndian ? out.writeInt16BE(v, o) : out.writeInt16LE(v, o);
  }
  return out;
}
export function encodeWav(channels, sampleRate, bits = 24) {
  const data = pcm(channels, bits, false), ch = channels.length, h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * ch * (bits / 8), 28); h.writeUInt16LE(ch * (bits / 8), 32); h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
export function encodeAiff(channels, sampleRate, bits = 24) {
  const data = pcm(channels, bits, true), ch = channels.length, n = channels[0].length;
  const comm = Buffer.alloc(26); comm.write("COMM", 0); comm.writeUInt32BE(18, 4); comm.writeUInt16BE(ch, 8); comm.writeUInt32BE(n, 10); comm.writeUInt16BE(bits, 14); writeExtended(comm, 16, sampleRate);
  const ssndHead = Buffer.alloc(16); ssndHead.write("SSND", 0); ssndHead.writeUInt32BE(8 + data.length, 4);
  const pad = data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  const form = Buffer.alloc(12); form.write("FORM", 0); form.writeUInt32BE(4 + comm.length + ssndHead.length + data.length + pad.length, 4); form.write("AIFF", 8);
  return Buffer.concat([form, comm, ssndHead, data, pad]);
}

/** Resample by linear interpolation (only used to bring odd rates to an MP3-legal rate). */
function resample(ch, from, to) {
  if (from === to) return ch;
  const n = Math.floor((ch.length * to) / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const x = i * r, a = Math.floor(x), f = x - a; out[i] = ch[a] * (1 - f) + (ch[a + 1] ?? ch[a]) * f; }
  return out;
}
export function encodeMp3(channels, sampleRate, kbps = 320) {
  const legal = [48000, 44100, 32000];
  const rate = legal.includes(sampleRate) ? sampleRate : sampleRate > 44100 ? 48000 : 44100;
  const [L, R] = channels.map((c) => resample(c, sampleRate, rate));
  const enc = new lamejs.Mp3Encoder(2, rate, kbps);
  const toI16 = (f, a, b) => { const o = new Int16Array(b - a); for (let i = a; i < b; i++) o[i - a] = Math.round(clamp(f[i]) * 32767); return o; };
  const parts = [], BLOCK = 1152 * 64;
  for (let i = 0; i < L.length; i += BLOCK) {
    const e = Math.min(L.length, i + BLOCK);
    const mp3 = enc.encodeBuffer(toI16(L, i, e), toI16(R, i, e));
    if (mp3.length) parts.push(Buffer.from(mp3.buffer, mp3.byteOffset, mp3.length));
  }
  const tail = enc.flush(); if (tail.length) parts.push(Buffer.from(tail.buffer, tail.byteOffset, tail.length));
  return Buffer.concat(parts);
}

/** Slice + fade for preview clips (sample-accurate, raised-cosine fades). */
export function clip(channels, sampleRate, start, end, fadeIn = 0.5, fadeOut = 3) {
  const a = Math.max(0, Math.round(start * sampleRate)), b = Math.min(channels[0].length, Math.round(end * sampleRate));
  const fi = Math.round(fadeIn * sampleRate), fo = Math.round(fadeOut * sampleRate), n = b - a;
  return channels.map((c) => {
    const o = c.slice(a, b);
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (i < fi) g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
      if (n - i < fo) g *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fo);
      o[i] *= g;
    }
    return o;
  });
}
