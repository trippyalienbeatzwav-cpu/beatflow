import crypto from "node:crypto";

let lastT = 0, seq = 0;
/** Time-sortable id: "<prefix>_" + 9 base36 chars of ms time + 3 of sequence + 6 random. */
export function id(prefix) {
  const t = Date.now();
  seq = t === lastT ? seq + 1 : 0;
  lastT = t;
  return `${prefix}_${t.toString(36).padStart(9, "0")}${seq.toString(36).padStart(3, "0")}${crypto.randomBytes(4).toString("hex").slice(0, 6)}`;
}
/** Same layout for a given past time (used by the seeder so ids stay chronological). */
export function idAt(prefix, t) {
  return `${prefix}_${Math.floor(t).toString(36).padStart(9, "0")}000${crypto.randomBytes(4).toString("hex").slice(0, 6)}`;
}
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
