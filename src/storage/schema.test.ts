import { beforeEach, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  INSERT_KEYSTROKE,
  INSERT_SESSION,
  MAX_EXPORT_KEYSTROKES,
  MAX_EXPORT_SESSIONS,
  MIGRATIONS,
  PRAGMAS,
  RECENT_SESSIONS,
  parseExport,
  pendingMigrations,
  type ExportPayload,
} from './schema';
import { CP } from '../khmer/__fixtures__/khmer';

/**
 * Runs the real statements against the real SQLite build the worker uses, in
 * memory. OPFS and the sahpool VFS need a browser, but the SQL does not — and
 * the SQL is where the mistakes live.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- oo1 Database is
// only typed for the browser entry point; the Node entry exposes the same shape.
type DB = any;

const sqlite3 = await sqlite3InitModule();
let db: DB;

const rows = (sql: string, bind: unknown[] = []): Record<string, unknown>[] =>
  db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });

const addSession = (startedAt: number, mode = 'time:30', cpm = 200, accuracy = 0.9, wpm = 20) =>
  rows(INSERT_SESSION, [startedAt, mode, 30_000, cpm, wpm, accuracy])[0]?.id as number;

beforeEach(() => {
  db?.close();
  db = new sqlite3.oo1.DB(':memory:');
  db.exec(PRAGMAS);
  for (const sql of MIGRATIONS) db.exec(sql);
});

describe('schema', () => {
  it('applies cleanly', () => {
    const tables = rows(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['keystrokes', 'sessions']));
  });

  it('replays the first migration harmlessly on a pre-migration database', () => {
    // A database created before migrations existed reports user_version 0, so
    // step 1 runs again over tables that are already there.
    expect(() => db.exec(MIGRATIONS[0]!)).not.toThrow();
  });

  it('carries the Phase 5 cluster columns', () => {
    const columns = rows(`PRAGMA table_info(keystrokes)`).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['target_cluster', 'subscript']));
  });

  it('creates every index Phase 5 will query through', () => {
    const indexes = rows(`SELECT name FROM sqlite_master WHERE type='index'`).map((i) => i.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_keystrokes_target',
        'idx_keystrokes_session',
        'idx_sessions_started_at',
      ]),
    );
  });

  it('actually uses the target index for the Phase 5 per-codepoint aggregate', () => {
    // A plan that says SCAN rather than SEARCH/USING INDEX means the index is
    // decorative — worth catching now, not when the table is large.
    const plan = rows(
      `EXPLAIN QUERY PLAN
       SELECT target_codepoint, AVG(correct) FROM keystrokes
       WHERE target_codepoint IS NOT NULL GROUP BY target_codepoint`,
    );
    expect(JSON.stringify(plan)).toMatch(/idx_keystrokes_target/);
  });
});

describe('sessions', () => {
  it('returns the new id straight from the insert', () => {
    expect(addSession(1_000)).toBe(1);
  });

  it('lists recent sessions newest first', () => {
    addSession(1_000, 'time:15');
    addSession(3_000, 'words:50');
    addSession(2_000, 'time:60');

    expect(rows(RECENT_SESSIONS, [10]).map((s) => s.mode)).toEqual([
      'words:50',
      'time:60',
      'time:15',
    ]);
  });

  it('honours the limit', () => {
    for (let i = 1; i <= 5; i++) addSession(i * 1_000);
    expect(rows(RECENT_SESSIONS, [2])).toHaveLength(2);
  });

  it('names its columns as the app reads them, not as the table spells them', () => {
    addSession(1_234, 'time:30', 250, 0.95, 24);
    expect(rows(RECENT_SESSIONS, [1])[0]).toEqual({
      id: 1,
      startedAt: 1_234,
      mode: 'time:30',
      durationMs: 30_000,
      cpm: 250,
      wpm: 24,
      accuracy: 0.95,
    });
  });
});

describe('keystrokes', () => {
  it('round-trips a Khmer codepoint without mangling it', () => {
    const id = addSession(1_000);
    db.exec({ sql: INSERT_KEYSTROKE, bind: [id, CP.COENG, CP.COENG, 1, CP.COENG, 1, 120] });

    const [row] = rows(`SELECT target_codepoint AS t, typed_codepoint AS k FROM keystrokes`);
    expect(row?.t).toBe(CP.COENG);
    expect(row?.k).toBe(CP.COENG);
  });

  it('stores a null target for a keystroke typed past the end', () => {
    const id = addSession(1_000);
    db.exec({ sql: INSERT_KEYSTROKE, bind: [id, null, null, 0, CP.KA, 0, 90] });
    expect(rows(`SELECT target_codepoint AS t FROM keystrokes`)[0]?.t).toBeNull();
  });

  it('deletes a session’s keystrokes with the session', () => {
    const id = addSession(1_000);
    db.exec({ sql: INSERT_KEYSTROKE, bind: [id, CP.KA, CP.KA, 0, CP.KA, 1, 100] });
    db.exec({ sql: 'DELETE FROM sessions WHERE id = ?', bind: [id] });

    // Without `PRAGMA foreign_keys = ON` the cascade silently does nothing and
    // orphaned keystrokes would skew every Phase 5 statistic.
    expect(rows(`SELECT COUNT(*) AS n FROM keystrokes`)[0]?.n).toBe(0);
  });

  it('refuses a keystroke pointing at a session that does not exist', () => {
    expect(() =>
      db.exec({ sql: INSERT_KEYSTROKE, bind: [999, CP.KA, CP.KA, 0, CP.KA, 1, 100] }),
    ).toThrow();
  });

  it('inserts a whole session of keystrokes in one transaction', () => {
    const id = addSession(1_000);
    const statement = db.prepare(INSERT_KEYSTROKE);
    db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        statement.bind([id, CP.KA, CP.KA, 0, CP.KA, 1, 100]).step();
        statement.reset();
      }
    });
    statement.finalize();

    expect(rows(`SELECT COUNT(*) AS n FROM keystrokes`)[0]?.n).toBe(500);
  });
});

describe('upgrading a database that already holds data', () => {
  /** Runs the same loop the worker runs, against a given starting version. */
  const runMigrations = (target: DB) => {
    const [row] = target.exec({
      sql: 'PRAGMA user_version',
      rowMode: 'array',
      returnValue: 'resultRows',
    });
    for (const step of pendingMigrations(Number(row?.[0] ?? 0))) {
      target.transaction(() => {
        target.exec(step.sql);
        target.exec(`PRAGMA user_version = ${step.version}`);
      });
    }
  };

  let legacy: DB;

  beforeEach(() => {
    // A Phase 4 database: v1 tables, real rows, and user_version still 0
    // because migrations did not exist when it was created.
    legacy = new sqlite3.oo1.DB(':memory:');
    legacy.exec(PRAGMAS);
    legacy.exec(MIGRATIONS[0]!);
    // Written with the v1 statement, not the current one: INSERT_SESSION now
    // names a wpm column that this database has not been migrated to have.
    legacy.exec({
      sql: `INSERT INTO sessions (started_at, mode, duration, cpm, accuracy)
            VALUES (?, ?, ?, ?, ?)`,
      bind: [1_000, 'time:30', 30_000, 210, 0.88],
    });
    legacy.exec({
      sql: `INSERT INTO keystrokes
              (session_id, target_codepoint, typed_codepoint, correct, ms_since_prev)
            VALUES (1, ?, ?, 1, 130)`,
      bind: [CP.KA, CP.KA],
    });
  });

  it('starts from version 0, as a pre-migration file does', () => {
    const [row] = legacy.exec({
      sql: 'PRAGMA user_version',
      rowMode: 'array',
      returnValue: 'resultRows',
    });
    expect(Number(row?.[0])).toBe(0);
  });

  it('adds the new columns without losing the existing rows', () => {
    runMigrations(legacy);

    const [session] = legacy.exec({
      sql: 'SELECT cpm, wpm FROM sessions',
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    expect(session?.cpm).toBe(210);
    // NULL, not a figure derived from cpm: a run's wpm counts clusters and its
    // cpm counts codepoints, so there is nothing to back-fill it from.
    expect(session?.wpm).toBe(null);

    const [key] = legacy.exec({
      sql: 'SELECT target_codepoint AS cp, target_cluster AS cluster, subscript FROM keystrokes',
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    // Rows written before the columns existed keep their data and take the
    // defaults for the new fields, rather than being dropped or invented.
    expect(key).toEqual({ cp: CP.KA, cluster: null, subscript: 0 });
  });

  it('stamps the version so it does not try again', () => {
    runMigrations(legacy);
    const [row] = legacy.exec({
      sql: 'PRAGMA user_version',
      rowMode: 'array',
      returnValue: 'resultRows',
    });
    expect(Number(row?.[0])).toBe(MIGRATIONS.length);
  });

  it('is safe to run twice, as reopening the database does', () => {
    runMigrations(legacy);
    // A second ALTER TABLE of the same column would throw if the version guard
    // were not doing its job.
    expect(() => runMigrations(legacy)).not.toThrow();
  });
});

describe('pendingMigrations', () => {
  it('runs every step on a fresh database', () => {
    expect(pendingMigrations(0)).toHaveLength(MIGRATIONS.length);
  });

  it('numbers the versions it will stamp', () => {
    expect(pendingMigrations(0).map((m) => m.version)).toEqual(
      MIGRATIONS.map((_, i) => i + 1),
    );
  });

  it('runs nothing on an up-to-date database', () => {
    expect(pendingMigrations(MIGRATIONS.length)).toEqual([]);
  });

  it('runs only what a partially migrated database still owes', () => {
    const pending = pendingMigrations(1);
    expect(pending).toHaveLength(MIGRATIONS.length - 1);
    expect(pending[0]?.version).toBe(2);
  });

  it('leaves a database from a newer build alone rather than downgrading it', () => {
    // Losing columns someone's data depends on is worse than a loud query error.
    expect(pendingMigrations(99)).toEqual([]);
  });
});

describe('parseExport', () => {
  /** A minimal but valid export — one session with one keystroke. */
  const validPayload = (): ExportPayload => ({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: 1_700_000_000_000,
    sessions: [
      {
        startedAt: 1_000,
        mode: 'time:30',
        durationMs: 30_000,
        cpm: 210,
        wpm: 21,
        accuracy: 0.9,
        keystrokes: [
          {
            targetCodepoint: CP.KA,
            targetCluster: CP.KA,
            subscript: false,
            typedCodepoint: CP.KA,
            correct: true,
            msSincePrev: 120,
          },
        ],
      },
    ],
  });

  it('round-trips a valid export unchanged', () => {
    const payload = validPayload();
    expect(parseExport(payload)).toEqual(payload);
  });

  it('accepts a session with no keystrokes', () => {
    const payload = validPayload();
    payload.sessions[0]!.keystrokes = [];
    expect(parseExport(payload).sessions[0]?.keystrokes).toEqual([]);
  });

  it('accepts a null targetCodepoint and targetCluster', () => {
    const payload = validPayload();
    payload.sessions[0]!.keystrokes[0]!.targetCodepoint = null;
    payload.sessions[0]!.keystrokes[0]!.targetCluster = null;
    expect(() => parseExport(payload)).not.toThrow();
  });

  it('rejects the wrong format string', () => {
    const payload: unknown = { ...validPayload(), format: 'some-other-app/export' };
    expect(() => parseExport(payload)).toThrow(/not a Khmer NiDA Trainer export/);
  });

  it('rejects a missing format entirely', () => {
    expect(() => parseExport({})).toThrow(/not a Khmer NiDA Trainer export/);
  });

  it('rejects an unsupported version with a distinct message for a newer one', () => {
    const payload = { ...validPayload(), version: EXPORT_VERSION + 1 };
    expect(() => parseExport(payload)).toThrow(/newer version/);
  });

  it('rejects an unsupported older version', () => {
    const payload = { ...validPayload(), version: 0 };
    expect(() => parseExport(payload)).toThrow(/no longer supported/);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseExport(null)).toThrow();
    expect(() => parseExport('a string')).toThrow();
    expect(() => parseExport(42)).toThrow();
  });

  it('rejects the whole file on one malformed session, naming its index', () => {
    const payload = validPayload();
    payload.sessions.push({ ...payload.sessions[0]!, accuracy: 1.5 });
    expect(() => parseExport(payload)).toThrow(/Session 1: accuracy/);
    // The first, valid session does not save it — the whole file is rejected.
  });

  it('rejects the whole file on one malformed keystroke, naming session and keystroke index', () => {
    const payload = validPayload();
    payload.sessions[0]!.keystrokes.push({
      ...payload.sessions[0]!.keystrokes[0]!,
      msSincePrev: -1,
    });
    expect(() => parseExport(payload)).toThrow(/Session 0 keystroke 1: msSincePrev/);
  });

  it('rejects a non-integer msSincePrev', () => {
    const payload = validPayload();
    payload.sessions[0]!.keystrokes[0]!.msSincePrev = 1.5;
    expect(() => parseExport(payload)).toThrow(/msSincePrev/);
  });

  it('rejects accuracy outside 0..1', () => {
    const payload = validPayload();
    payload.sessions[0]!.accuracy = -0.1;
    expect(() => parseExport(payload)).toThrow(/accuracy/);
  });

  it('rejects a non-finite number', () => {
    const payload = validPayload();
    payload.sessions[0]!.cpm = Infinity;
    expect(() => parseExport(payload)).toThrow(/cpm/);
  });

  it('enforces the session cap', () => {
    const payload = validPayload();
    payload.sessions = Array.from({ length: MAX_EXPORT_SESSIONS + 1 }, () => payload.sessions[0]!);
    expect(() => parseExport(payload)).toThrow(new RegExp(`over the ${MAX_EXPORT_SESSIONS} limit`));
  });

  it('enforces the total keystroke cap across all sessions', () => {
    const payload = validPayload();
    // One session carrying more keystrokes than the cap allows, rather than
    // MAX_EXPORT_KEYSTROKES+1 real array entries — same check, far cheaper to
    // build.
    const keystroke = payload.sessions[0]!.keystrokes[0]!;
    payload.sessions[0]!.keystrokes = Array.from(
      { length: MAX_EXPORT_KEYSTROKES + 1 },
      () => keystroke,
    );
    expect(() => parseExport(payload)).toThrow(/more than .* keystrokes/);
  });
});

describe('wpm on exports', () => {
  /** An export as written before the wpm column existed. */
  const legacy = () => ({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: 1_700_000_000_000,
    sessions: [
      {
        startedAt: 1_000,
        mode: 'time:30',
        durationMs: 30_000,
        cpm: 210,
        accuracy: 0.9,
        keystrokes: [],
      } as Record<string, unknown>,
    ],
  });

  it('accepts an export written before wpm existed', () => {
    // Backups people already hold must keep importing, and the session comes
    // back with wpm null rather than a number invented from its cpm.
    expect(parseExport(legacy()).sessions[0]?.wpm).toBe(null);
  });

  it('keeps a wpm that is there', () => {
    const payload = legacy();
    payload.sessions[0]!.wpm = 42;
    expect(parseExport(payload).sessions[0]?.wpm).toBe(42);
  });

  it('rejects a wpm that is present but not a number', () => {
    const payload = legacy();
    payload.sessions[0]!.wpm = 'fast';
    expect(() => parseExport(payload)).toThrow(/wpm/);
  });
});
