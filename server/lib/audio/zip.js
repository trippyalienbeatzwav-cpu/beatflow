// Minimal ZIP writer (stored entries, CRC-32) that streams to a file entry by entry, so large archives
// (stems, packs, releases) never sit in memory at once. Audio doesn't compress with deflate anyway.
// Also a reader for the central directory, used to validate uploaded stems archives.
import fs from "node:fs";

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf, crc = 0) { let c = ~crc >>> 0; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
// eslint-disable-next-line no-control-regex -- strips control characters from entry names
const safeName = (n) => String(n).replace(/[\\:*?"<>|\x00-\x1f]/g, "_").replace(/\.\.+/g, ".").replace(/^\/+/, "").slice(0, 200);

export class ZipWriter {
  constructor(file) { this.fd = fs.openSync(file, "w"); this.offset = 0; this.entries = []; this.names = new Set(); }
  add(name, data, when = new Date()) {
    name = safeName(name);
    if (this.names.has(name)) throw new Error(`Duplicate zip entry ${name}`);
    this.names.add(name);
    if (this.offset + data.length > 0xfffffff0) throw new Error("Archive would exceed 4 GB (ZIP64 not supported)");
    const nameBuf = Buffer.from(name, "utf8"), crc = crc32(data), { time, date } = dosTime(when);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    fs.writeSync(this.fd, h); fs.writeSync(this.fd, nameBuf); fs.writeSync(this.fd, data);
    this.entries.push({ nameBuf, crc, size: data.length, offset: this.offset, time, date });
    this.offset += h.length + nameBuf.length + data.length;
  }
  close() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24); c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
      fs.writeSync(this.fd, c); fs.writeSync(this.fd, e.nameBuf);
      this.offset += c.length + e.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12); end.writeUInt32LE(start, 16);
    fs.writeSync(this.fd, end); fs.closeSync(this.fd);
    return this.offset + 22;
  }
}

/** List entries of a ZIP (central directory). Throws on anything malformed or unsafe. */
export function listZip(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size, tailLen = Math.min(size, 65557), tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error("Not a ZIP archive.");
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff + cdSize > size || count > 5000) throw new Error("Corrupt ZIP archive.");
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    for (let o = 0, i = 0; i < count; i++) {
      if (cd.readUInt32LE(o) !== 0x02014b50) throw new Error("Corrupt ZIP directory.");
      const method = cd.readUInt16LE(o + 10), csize = cd.readUInt32LE(o + 20), usize = cd.readUInt32LE(o + 24), nl = cd.readUInt16LE(o + 28), xl = cd.readUInt16LE(o + 30), cl = cd.readUInt16LE(o + 32);
      const name = cd.subarray(o + 46, o + 46 + nl).toString("utf8");
      if (name.includes("..") || name.startsWith("/") || /^[a-z]:/i.test(name)) throw new Error("The archive contains unsafe paths.");
      out.push({ name, method, compressed: csize, size: usize });
      o += 46 + nl + xl + cl;
    }
    return out;
  } finally { fs.closeSync(fd); }
}
