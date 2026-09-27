// Versioned migrations for databases created by an older release. New databases are built straight from
// schema.sql + schema-store.sql and stamped with LATEST, so every migration must leave an existing
// database identical in shape to a fresh one. Each runs in one transaction with foreign keys off.

/**
 * SQLite can't change a CHECK constraint in place, so the table is rebuilt: create a copy from the
 * edited CREATE statement, copy rows, drop the old table, rename, and recreate its indexes and triggers.
 */
function rebuild(raw, table, edits) {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row) throw new Error(`No table ${table}`);
  let sql = row.sql;
  for (const [from, to] of edits) {
    if (!sql.includes(from)) throw new Error(`${table}: expected to find ${from}`);
    sql = sql.replace(from, to);
  }
  const extras = raw.prepare("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name = ? AND sql IS NOT NULL").all(table);
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => `"${c.name}"`).join(", ");
  raw.exec(sql.replace(/^CREATE TABLE (IF NOT EXISTS )?"?\w+"?/, `CREATE TABLE ${table}__new`));
  raw.exec(`INSERT INTO ${table}__new (${cols}) SELECT ${cols} FROM ${table}`);
  raw.exec(`DROP TABLE ${table}`);
  raw.exec(`ALTER TABLE ${table}__new RENAME TO ${table}`);
  for (const x of extras) raw.exec(x.sql);
}
const hasColumn = (raw, table, col) => raw.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const addColumn = (raw, table, col, def) => { if (!hasColumn(raw, table, col)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };

export const MIGRATIONS = [
  {
    version: 2,
    name: "stores, account security, private media",
    up(raw) {
      // Account security
      addColumn(raw, "users", "email_verified_at", "INTEGER");
      addColumn(raw, "users", "password_changed_at", "INTEGER");
      addColumn(raw, "users", "failed_logins", "INTEGER NOT NULL DEFAULT 0");
      addColumn(raw, "users", "locked_until", "INTEGER");
      addColumn(raw, "sessions", "user_agent", "TEXT");
      // Accounts that existed before verification was introduced are treated as verified
      raw.exec("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
      // Private media (masters, stems) is never served from /media
      addColumn(raw, "media", "access", "TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public','private'))");
      // Store money flows through the same payments, earnings and ledger tables
      rebuild(raw, "payments", [["purpose IN ('credit_purchase','donation')", "purpose IN ('credit_purchase','donation','store_checkout')"]]);
      rebuild(raw, "earnings", [["source_type IN ('gift','donation')", "source_type IN ('gift','donation','sale')"]]);
      rebuild(raw, "transactions", [["'refund','refund_reversal','adjustment')", "'refund','refund_reversal','adjustment',\n                                              'purchase','sale_received','sale_reversal')"]]);
      rebuild(raw, "upload_sessions", [["'live_thumbnail','poster','variant')", "'live_thumbnail','poster','variant','master_audio','artwork','stems_archive')"]]);
    },
  },
  {
    version: 3,
    name: "store items can be reported",
    up(raw) {
      rebuild(raw, "reports", [["'user','comment','live_message')", "'user','comment','live_message','beat','pack','track','release')"]]);
    },
  },
];
export const LATEST = MIGRATIONS.at(-1).version;
