// Worker pool for audio jobs. Identical requests share one job (keyed by output file), finished files
// are served from a disk cache, and the cache is trimmed to a size cap (least recently used first).
import { Worker } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const WORKER = new URL("./worker.js", import.meta.url);

export function createAudioJobs({ cacheDir, workers = Math.max(1, Math.min(2, os.cpus().length - 1)), cacheMaxBytes = 5 * 1024 ** 3, timeoutMs = 10 * 60_000, log = (..._args) => {} }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const pool = [], queue = [], inflight = new Map();
  let seq = 0, closed = false;

  function spawn() {
    const w = new Worker(WORKER);
    const slot = { w, busy: null };
    w.on("message", ({ id, result, error }) => {
      const b = slot.busy; slot.busy = null;
      if (b && b.id === id) { clearTimeout(b.timer); error ? b.reject(Object.assign(new Error(error.message), { code: error.code })) : b.resolve(result); }
      pump();
    });
    w.on("error", (err) => {
      log("audio worker crashed", err);
      const b = slot.busy; slot.busy = null;
      if (b) { clearTimeout(b.timer); b.reject(err); }
      pool.splice(pool.indexOf(slot), 1);
      if (!closed) { pool.push(spawn()); pump(); }
    });
    return slot;
  }
  for (let i = 0; i < workers; i++) pool.push(spawn());

  function pump() {
    for (const slot of pool) {
      if (slot.busy || !queue.length) continue;
      const task = queue.shift();
      slot.busy = task;
      task.timer = setTimeout(() => { if (slot.busy === task) { slot.w.terminate(); task.reject(Object.assign(new Error("Audio job timed out"), { code: "job_timeout" })); } }, timeoutMs);
      task.timer.unref?.();
      slot.w.postMessage({ id: task.id, job: task.job });
    }
  }
  function run(job) {
    if (closed) return Promise.reject(new Error("Audio jobs are shut down"));
    return new Promise((resolve, reject) => { queue.push({ id: ++seq, job, resolve, reject }); pump(); });
  }
  /** Produce (or reuse) a cached file. Concurrent calls for the same file share one job. */
  function file(rel, job) {
    const out = path.join(cacheDir, rel);
    if (!out.startsWith(path.resolve(cacheDir))) throw new Error("Bad cache path");
    if (fs.existsSync(out)) { const now = new Date(); fs.utimesSync(out, now, now); return Promise.resolve({ path: out, bytes: fs.statSync(out).size, cached: true }); }
    if (inflight.has(out)) return inflight.get(out);
    const p = run({ ...job, out }).then((r) => ({ ...r, path: out, bytes: fs.statSync(out).size, cached: false })).finally(() => inflight.delete(out));
    inflight.set(out, p);
    return p;
  }
  function trim() {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push({ p, ...fs.statSync(p) }); } };
    walk(cacheDir);
    // Half-written temp files from a crash
    for (const f of files.filter((x) => x.p.endsWith(".tmp") && Date.now() - x.mtimeMs > 3600_000)) fs.rmSync(f.p, { force: true });
    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of files.filter((x) => !x.p.endsWith(".tmp")).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= cacheMaxBytes) break;
      if ([...inflight.keys()].includes(f.p)) continue;
      fs.rmSync(f.p, { force: true }); total -= f.size;
    }
    return total;
  }
  return {
    run, file, trim, cacheDir,
    stats: () => ({ workers: pool.length, busy: pool.filter((s) => s.busy).length, queued: queue.length }),
    async close() { closed = true; for (const t of queue.splice(0)) t.reject(new Error("shutdown")); await Promise.all(pool.map((s) => s.w.terminate())); },
  };
}
