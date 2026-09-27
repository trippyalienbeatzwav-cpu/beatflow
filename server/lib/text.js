// User-supplied store text (titles, names, bios, descriptions, tags) is rendered into HTML by several clients.
// Defence in depth on top of template escaping: strip markup characters and control codes at the boundary and
// use typographic quotes, so a value is harmless even if a template forgets to escape it (including in attributes).
// eslint-disable-next-line no-control-regex -- intentionally matches control characters
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
export const plain = (v) => String(v ?? "").replace(/[<>]/g, "").replace(/"/g, "”").replace(CONTROL, " ");
