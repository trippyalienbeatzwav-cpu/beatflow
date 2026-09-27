// Loads the fictional seed catalog (beats-catalog.js, electronic-catalog.js) into plain objects.
// The definition files are classic scripts that populate a `BF` namespace; they are evaluated in an
// isolated VM with the deterministic RNG from js/art.js. Artwork stays generative: instead of SVG
// strings we keep the parameters ({ seed, style, palette }) and the client renders the image.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

export function loadSeedCatalog({ brandName = "TUNIBEAT" } = {}) {
  const ctx = { console, BF: { brand: { name: brandName, displayName: brandName } } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "art.js"), "utf8"), ctx, { filename: "art.js" });
  const BF = ctx.BF;
  BF.art = (seed, style, palette) => ({ seed: String(seed), style, palette });
  BF.avatar = (seed, palette) => ({ seed: String(seed), palette });
  BF.banner = (seed, palette) => ({ seed: String(seed), palette });
  for (const f of ["beats-catalog.js", "electronic-catalog.js"]) vm.runInContext(fs.readFileSync(path.join(here, f), "utf8"), ctx, { filename: f });
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const packRelease = new Set(["sample-pack", "loops", "stems"]);
  return {
    beatGenres: plain(BF.GENRES),
    producers: plain(BF.PRODUCERS),
    licenses: plain(BF.LICENSES),
    beats: plain(BF.BEATS),
    packs: plain(BF.PACKS),
    reviews: plain(BF.REVIEWS),
    playlists: plain(BF.PLAYLISTS),
    electronicGenres: plain(BF.EGENRES_BASE),
    labels: plain(BF.LABELS),
    artists: plain(BF.EARTISTS),
    releases: plain(BF.RELEASES).filter((r) => !packRelease.has(r.type)),
    tracks: plain(BF.ETRACKS),
    camelot: (k) => BF.camelot(k),
  };
}
