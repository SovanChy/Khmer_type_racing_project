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

  // v3 — words per minute alongside characters per minute.
  //
  // Nullable, and deliberately not backfilled: wpm counts correct CLUSTERS per
  // CLUSTERS_PER_WORD, cpm counts correct codepoints, and a Khmer cluster runs
  // one to three codepoints depending on the text. There is no ratio that turns
  // a stored cpm into the wpm that run actually scored, so rows written before
  // this migration report NULL rather than a plausible-looking guess.
  `
  ALTER TABLE sessions ADD COLUMN wpm REAL;
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
  /** NULL on sessions saved before the v3 migration — see MIGRATIONS. */
  wpm: number | null;
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
INSERT INTO sessions (started_at, mode, duration, cpm, wpm, accuracy)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING id
`;

export const INSERT_KEYSTROKE = `
INSERT INTO keystrokes
  (session_id, target_codepoint, target_cluster, subscript, typed_codepoint, correct, ms_since_prev)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const RECENT_SESSIONS = `
SELECT id, started_at AS startedAt, mode, duration AS durationMs, cpm, wpm, accuracy
FROM sessions
ORDER BY started_at DESC
LIMIT ?
`;

/** Every session, oldest first, for a full JSON export. */
export const ALL_SESSIONS = `
SELECT id, started_at AS startedAt, mode, duration AS durationMs, cpm, wpm, accuracy
FROM sessions
ORDER BY id ASC
`;

/**
 * Every keystroke, grouped by session in insertion order, for a full JSON
 * export. `rowid` (not a real column here) is SQLite's implicit insertion
 * order, which is the only ordering this table has.
 */
export const ALL_KEYSTROKES = `
SELECT session_id       AS sessionId,
       target_codepoint AS targetCodepoint,
       target_cluster   AS targetCluster,
       subscript,
       typed_codepoint  AS typedCodepoint,
       correct,
       ms_since_prev    AS msSincePrev
FROM keystrokes
ORDER BY session_id ASC, rowid ASC
`;

// ---------------------------------------------------------------------------
// JSON export/import (F-02)
//
// Export stays `.sqlite3` (see db.worker.ts `exportDatabase`) — that path is
// safe, it never parses attacker-supplied bytes. Import goes the other way:
// this is the format an uploaded file is validated against, so the SQLite
// parser is never handed a file from outside the app. See SECURITY-REVIEW.md
// §7.
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = 'khmer-nida-trainer/export';
export const EXPORT_VERSION = 1;

/**
 * Rejected before `JSON.parse` runs, by the caller that has the raw text (this
 * module stays browser-API-free, so it never sees a byte length itself). Even
 * a maximally dense encoding of MAX_EXPORT_KEYSTROKES rows runs well past this
 * — the cap exists to bound worst-case memory for a hostile file, not to
 * describe realistic use.
 */
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

/** One session a day for over a century. Real history will never come close. */
export const MAX_EXPORT_SESSIONS = 50_000;

/** ~40 keystrokes/test average leaves enormous headroom before this bites. */
export const MAX_EXPORT_KEYSTROKES = 2_000_000;

export interface ExportedSession extends SessionRecord {
  keystrokes: KeystrokeRecord[];
}

export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  sessions: ExportedSession[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeInt(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

/**
 * Validates an imported export and returns it typed, or throws an `Error`
 * naming exactly what was wrong.
 *
 * Unlike `parseCorpus()`, which skips bad entries because the corpus is
 * hand-edited, low-stakes, and never the user's own data — this rejects the
 * *whole* file on the first bad entry. Import replaces the user's entire
 * history; silently dropping a malformed session would look like a
 * successful restore while quietly losing data, which is worse than failing
 * loudly and leaving the existing history untouched.
 */
export function parseExport(payload: unknown): ExportPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('That file is not a valid export: expected a JSON object.');
  }
  const obj = payload as Record<string, unknown>;

  if (obj.format !== EXPORT_FORMAT) {
    throw new Error('That file is not a Khmer NiDA Trainer export.');
  }
  if (typeof obj.version !== 'number') {
    throw new Error('That export has no version number.');
  }
  if (obj.version > EXPORT_VERSION) {
    throw new Error(
      `That export was made by a newer version of the app (format v${obj.version}). Update the app before importing it.`,
    );
  }
  if (obj.version !== EXPORT_VERSION) {
    throw new Error(`That export's format version (v${obj.version}) is no longer supported.`);
  }
  if (!isFiniteNumber(obj.exportedAt)) {
    throw new Error('That export is missing a valid exportedAt timestamp.');
  }
  if (!Array.isArray(obj.sessions)) {
    throw new Error('That export has no sessions array.');
  }
  if (obj.sessions.length > MAX_EXPORT_SESSIONS) {
    throw new Error(
      `That export has ${obj.sessions.length} sessions, over the ${MAX_EXPORT_SESSIONS} limit.`,
    );
  }

  let totalKeystrokes = 0;
  const sessions: ExportedSession[] = obj.sessions.map((rawSession, sIdx) => {
    if (typeof rawSession !== 'object' || rawSession === null) {
      throw new Error(`Session ${sIdx}: not an object.`);
    }
    const s = rawSession as Record<string, unknown>;

    if (!isFiniteNumber(s.startedAt)) {
      throw new Error(`Session ${sIdx}: startedAt must be a number.`);
    }
    if (typeof s.mode !== 'string' || s.mode === '') {
      throw new Error(`Session ${sIdx}: mode must be a non-empty string.`);
    }
    if (!isNonNegativeInt(s.durationMs)) {
      throw new Error(`Session ${sIdx}: durationMs must be a non-negative integer.`);
    }
    if (!isFiniteNumber(s.cpm)) {
      throw new Error(`Session ${sIdx}: cpm must be a number.`);
    }
    // Optional, not required: exports written before wpm existed are still
    // valid, and rejecting them would strand backups people already hold.
    if (s.wpm !== undefined && s.wpm !== null && !isFiniteNumber(s.wpm)) {
      throw new Error(`Session ${sIdx}: wpm must be a number, null or absent.`);
    }
    if (!isFiniteNumber(s.accuracy) || s.accuracy < 0 || s.accuracy > 1) {
      throw new Error(`Session ${sIdx}: accuracy must be a number between 0 and 1.`);
    }
    if (!Array.isArray(s.keystrokes)) {
      throw new Error(`Session ${sIdx}: keystrokes must be an array.`);
    }

    totalKeystrokes += s.keystrokes.length;
    if (totalKeystrokes > MAX_EXPORT_KEYSTROKES) {
      throw new Error(`That export has more than ${MAX_EXPORT_KEYSTROKES} keystrokes in total.`);
    }

    const keystrokes: KeystrokeRecord[] = s.keystrokes.map((rawKey, kIdx) => {
      if (typeof rawKey !== 'object' || rawKey === null) {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: not an object.`);
      }
      const k = rawKey as Record<string, unknown>;

      if (!isNullableString(k.targetCodepoint)) {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: targetCodepoint must be a string or null.`);
      }
      if (!isNullableString(k.targetCluster)) {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: targetCluster must be a string or null.`);
      }
      if (typeof k.subscript !== 'boolean') {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: subscript must be a boolean.`);
      }
      if (typeof k.typedCodepoint !== 'string') {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: typedCodepoint must be a string.`);
      }
      if (typeof k.correct !== 'boolean') {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: correct must be a boolean.`);
      }
      if (!isNonNegativeInt(k.msSincePrev)) {
        throw new Error(`Session ${sIdx} keystroke ${kIdx}: msSincePrev must be a non-negative integer.`);
      }

      return {
        targetCodepoint: k.targetCodepoint,
        targetCluster: k.targetCluster,
        subscript: k.subscript,
        typedCodepoint: k.typedCodepoint,
        correct: k.correct,
        msSincePrev: k.msSincePrev,
      };
    });

    return {
      startedAt: s.startedAt,
      mode: s.mode,
      durationMs: s.durationMs,
      cpm: s.cpm,
      wpm: isFiniteNumber(s.wpm) ? s.wpm : null,
      accuracy: s.accuracy,
      keystrokes,
    };
  });

  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: obj.exportedAt, sessions };
}
