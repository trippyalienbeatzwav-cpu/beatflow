// SQLite access (node:sqlite). Every write that must be atomic goes through tx().
// Node runs request handlers on one thread, and tx() runs synchronously, so two requests
// can never interleave inside a transaction. BEGIN IMMEDIATE also guards against other processes.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
const SCHEMA_FILES = ["schema.sql", "schema-store.sql"].map((f) => path.join(dbDir, f));
import { MIGRATIONS, LATEST } from "../db/migrations.js";

const bind = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
const namesCache = new Map();
// Named-parameter objects may carry keys a query variant doesn't use; SQLite rejects unknown names, so drop them.
const bindAll = (sql, args) => args.map((a) => {
  if (!(a && typeof a === "object" && !Array.isArray(a) && !(a instanceof Uint8Array))) return bind(a);
  let names = namesCache.get(sql);
  if (!names) { names = new Set([...sql.matchAll(/[:$@]([A-Za-z_]\w*)/g)].map((m) => m[1])); namesCache.set(sql, names); }
  return Object.fromEntries(Object.entries(a).filter(([k]) => names.has(k)).map(([k, v]) => [k, bind(v)]));
});

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  if (file !== ":memory:") raw.exec("PRAGMA journal_mode = WAL;");
  migrate(raw);

  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  const db = {
    raw,
    get: (sql, ...a) => { const r = prep(sql).get(...bindAll(sql, a)); return r ? { ...r } : undefined; },
    all: (sql, ...a) => prep(sql).all(...bindAll(sql, a)).map((r) => ({ ...r })),
    run: (sql, ...a) => prep(sql).run(...bindAll(sql, a)),
    exec: (sql) => raw.exec(sql),
    /** Run fn atomically. Nested calls become savepoints. fn must be synchronous. */
    tx(fn) {
      const sp = `sp${depth}`;
      raw.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const out = fn();
        if (out && typeof out.then === "function") throw new Error("db.tx callback must be synchronous");
        depth--;
        raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return out;
      } catch (err) {
        depth--;
        raw.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    },
    close: () => raw.close(),
  };
  return db;
}

/**
 * Schema management. A new database gets the current schema files and is stamped with the latest
 * version (PRAGMA user_version). An existing database runs every migration newer than its version,
 * then the schema files (CREATE ... IF NOT EXISTS adds new tables and indexes).
 * Version 0 on a database that already has tables means "created before migrations existed" (= v1).
 */
function migrate(raw) {
  const exists = raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  const schema = () => { for (const f of SCHEMA_FILES) raw.exec(fs.readFileSync(f, "utf8")); };
  if (!exists) { schema(); raw.exec(`PRAGMA user_version = ${LATEST}`); return; }
  let version = raw.prepare("PRAGMA user_version").get().user_version || 1;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    // Table rebuilds need foreign keys off (outside the transaction), then a full integrity check
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.exec("BEGIN IMMEDIATE");
    try {
      m.up(raw);
      const bad = raw.prepare("PRAGMA foreign_key_check").all();
      if (bad.length) throw new Error(`Migration ${m.version} broke ${bad.length} foreign key(s): ${JSON.stringify(bad.slice(0, 3))}`);
      raw.exec(`PRAGMA user_version = ${m.version}`);
      raw.exec("COMMIT");
    } catch (err) {
      raw.exec("ROLLBACK");
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
    } finally {
      raw.exec("PRAGMA foreign_keys = ON");
    }
    version = m.version;
  }
  schema();
}

export const json = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
