/**
 * The database contract: migrations, statements and record shapes.
 *
 * Kept free of any browser API on purpose. The worker runs these against
 * SQLite-WASM in OPFS; `schema.test.ts` runs the exact same SQL against the
 * exact same SQLite build in Node, so the statements are verified without
 * needing a browser.
 */

/** Absolute path — the sahpool VFS requires a leading slash. */
export const DB_FILENAME = '/khmer-nida-trainer.sqlite3';

/** Per-connection, not stored in the file, so this runs on every open. */
export const PRAGMAS = `
PRAGMA foreign_keys = ON;
`;

/**
 * Applied in order; the file's `PRAGMA user_version` records how far it got.
 *
 * Append only — never edit a shipped entry, or databases in the wild diverge
 * from fresh ones with no way to tell.
 */
export const MIGRATIONS: readonly string[] = [
  // v1 — sessions and keystrokes.
  // IF NOT EXISTS throughout so a database created before migrations existed
  // (and so reporting user_version 0) passes through this step untouched.
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  INTEGER NOT NULL,        -- epoch ms
    mode        TEXT    NOT NULL,        -- 'time:30' | 'words:50'
    duration    INTEGER NOT NULL,        -- ms actually elapsed
    cpm         REAL    NOT NULL,
    accuracy    REAL    NOT NULL         -- 0..1
  );

  CREATE TABLE IF NOT EXISTS keystrokes (
    session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target_codepoint TEXT,               -- NULL when typed past the end of the target
    typed_codepoint  TEXT    NOT NULL,
    correct          INTEGER NOT NULL,   -- 0 | 1
    ms_since_prev    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_keystrokes_target
    ON keystrokes(target_codepoint, correct);
  CREATE INDEX IF NOT EXISTS idx_keystrokes_session
    ON keystrokes(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_started_at
    ON sessions(started_at DESC);
  `,

  // v2 — cluster attribution for Phase 5.
  //
  // Per-codepoint rows cannot answer "which cluster do you get wrong", and a
  // cluster is not reconstructible from a row in isolation. Both values are
  // known for free at write time, so they are recorded rather than re-derived.
  `
  ALTER TABLE keystrokes ADD COLUMN target_cluster TEXT;
  ALTER TABLE keystrokes ADD COLUMN subscript INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_keystrokes_cluster
    ON keystrokes(target_cluster, correct);
  CREATE INDEX IF NOT EXISTS idx_keystrokes_subscript
    ON keystrokes(subscript, target_codepoint);
  `,
];

/**
 * Migrations this database still owes, newest last. A file from a *newer* build
 * is left alone rather than downgraded — better to fail a query loudly than to
 * quietly drop columns someone's data depends on.
 */
export function pendingMigrations(userVersion: number): { sql: string; version: number }[] {
  return MIGRATIONS.slice(Math.max(0, userVersion)).map((sql, i) => ({
    sql,
    version: Math.max(0, userVersion) + i + 1,
  }));
}

export interface SessionRecord {
  /** Epoch ms, so it survives export/import across machines. */
  startedAt: number;
  mode: string;
  durationMs: number;
  cpm: number;
  /** 0..1, not a percentage. */
  accuracy: number;
}

export interface StoredSession extends SessionRecord {
  id: number;
}

export interface KeystrokeRecord {
  /** NULL when the user typed past the end of the target. */
  targetCodepoint: string | null;
  /** The whole cluster the target codepoint belongs to. */
  targetCluster: string | null;
  /** True when the target codepoint is the consonant directly after a coeng. */
  subscript: boolean;
  typedCodepoint: string;
  correct: boolean;
  msSincePrev: number;
}

/** RETURNING avoids a second round trip for last_insert_rowid(). */
export const INSERT_SESSION = `
INSERT INTO sessions (started_at, mode, duration, cpm, accuracy)
VALUES (?, ?, ?, ?, ?)
RETURNING id
`;

export const INSERT_KEYSTROKE = `
INSERT INTO keystrokes
  (session_id, target_codepoint, target_cluster, subscript, typed_codepoint, correct, ms_since_prev)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const RECENT_SESSIONS = `
SELECT id, started_at AS startedAt, mode, duration AS durationMs, cpm, accuracy
FROM sessions
ORDER BY started_at DESC
LIMIT ?
`;

/** "SQLite format 3\0" — the 16 header bytes every SQLite file starts with. */
const MAGIC = [...'SQLite format 3'].map((c) => c.charCodeAt(0)).concat(0);

/**
 * Cheap sanity check before handing an uploaded file to `importDb`, which would
 * otherwise throw something opaque. An import replaces the user's entire
 * history, so it is worth failing loudly and early on an obviously wrong file.
 */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}
