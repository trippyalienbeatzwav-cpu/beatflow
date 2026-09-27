// Production build: bundles the front end into content-hashed files in dist/.
//   dist/index.html                  scripts and stylesheets rewritten to the bundles
//   dist/js/app.<hash>.js            every <script src> from index.html, concatenated in page order
//   dist/css/app.<hash>.css          every local stylesheet, concatenated in page order
//   dist/js/music/analyzer.worker.js + dsp.js   (loaded at runtime by the analysis Worker)
//   dist/assets/                     preview audio, waveform analysis, images
// Serve it with WEB_ROOT=dist npm start. The build fails if any referenced file is missing
// or a bundle does not parse.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
const t0 = Date.now();
const read = (rel) => {
  const f = path.join(root, rel);
  if (!fs.existsSync(f)) throw new Error(`Referenced file is missing: ${rel}`);
  return fs.readFileSync(f, "utf8");
};
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);

let html = read("index.html");
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>\n?/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">\n?/g)].map((m) => m[1]);
if (!scripts.length || !styles.length) throw new Error("No scripts or stylesheets found in index.html");

const js = scripts.map((s) => `/* ${s} */\n${read(s)}\n;`).join("\n");
new vm.Script(js, { filename: "app.js" });   // syntax check of the whole bundle
const css = styles.map((s) => `/* ${s} */\n${read(s)}`).join("\n");
const jsName = `js/app.${hash(js)}.js`, cssName = `css/app.${hash(css)}.css`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "js/music"), { recursive: true });
fs.mkdirSync(path.join(out, "css"), { recursive: true });
fs.writeFileSync(path.join(out, jsName), js);
fs.writeFileSync(path.join(out, cssName), css);
for (const f of ["js/music/analyzer.worker.js", "js/music/dsp.js"]) fs.writeFileSync(path.join(out, f), read(f));
fs.cpSync(path.join(root, "assets"), path.join(out, "assets"), { recursive: true });

// Replace the first tag of each kind with the bundle and drop the rest
let firstJs = true, firstCss = true;
html = html.replace(/<script src="[^"]+"><\/script>\n?/g, () => (firstJs ? ((firstJs = false), `<script src="${jsName}"></script>\n`) : ""));
html = html.replace(/<link rel="stylesheet" href="css\/[^"]+">\n?/g, () => (firstCss ? ((firstCss = false), `<link rel="stylesheet" href="${cssName}">\n`) : ""));
fs.writeFileSync(path.join(out, "index.html"), html);

const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`;
console.log(`build: ${scripts.length} scripts → ${jsName} (${size(jsName)}), ${styles.length} stylesheets → ${cssName} (${size(cssName)}), assets copied, ${Date.now() - t0} ms`);
