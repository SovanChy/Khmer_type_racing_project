import { beforeEach, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {
  PAUSE_CUTOFF_MS,
  RECENCY_HALF_LIFE_MS,
  SESSION_TREND,
  SLOWEST_CODEPOINTS,
  WORST_CLUSTERS,
  WORST_SUBSCRIPTS,
} from './analytics';
import { INSERT_KEYSTROKE, INSERT_SESSION, MIGRATIONS, PRAGMAS } from './schema';
import { COENG_STACK, CP, KHMER, SREY } from '../khmer/__fixtures__/khmer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the oo1 Database
// is only typed for the browser entry point; the Node entry has the same shape.
type DB = any;

const sqlite3 = await sqlite3InitModule();
let db: DB;

const rows = (sql: string, bind: unknown = []): Record<string, unknown>[] =>
  db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const addSession = (startedAt: number, cpm = 200, accuracy = 0.9, wpm: number | null = 20): number =>
  rows(INSERT_SESSION, [startedAt, 'time:30', 30_000, cpm, wpm, accuracy])[0]?.id as number;

interface Key {
  cp: string;
  cluster?: string | null;
  subscript?: boolean;
  correct?: boolean;
  ms?: number;
}

const addKeys = (sessionId: number, keys: Key[]) => {
  for (const k of keys) {
    db.exec({
      sql: INSERT_KEYSTROKE,
      bind: [
        sessionId,
        k.cp,
        k.cluster ?? null,
        k.subscript ? 1 : 0,
        k.cp,
        k.correct === false ? 0 : 1,
        k.ms ?? 150,
      ],
    });
  }
};

beforeEach(() => {
  db?.close();
  db = new sqlite3.oo1.DB(':memory:');
  db.exec(PRAGMAS);
  for (const sql of MIGRATIONS) db.exec(sql);
});

describe('WORST_CLUSTERS', () => {
  const bind = { $minAttempts: 2, $limit: 10 };

  it('ranks the least accurate cluster first', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
      { cp: CP.SA, cluster: SREY, correct: true },
      { cp: CP.SA, cluster: SREY, correct: true },
    ]);

    expect(rows(WORST_CLUSTERS, bind).map((r) => r.cluster)).toEqual([COENG_STACK, SREY]);
  });

  it('reports attempts and correct counts per cluster', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
      { cp: CP.KA, cluster: COENG_STACK, correct: true },
      { cp: CP.KA, cluster: COENG_STACK, correct: true },
    ]);

    expect(rows(WORST_CLUSTERS, bind)[0]).toMatchObject({ attempts: 3, correct: 2 });
  });

  it('does not let a single mistake top the ranking forever', () => {
    // 0/1 is 0% accuracy; without the floor it outranks a genuinely weak cluster.
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.RO, cluster: KHMER, correct: false },
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
    ]);

    expect(rows(WORST_CLUSTERS, bind).map((r) => r.cluster)).toEqual([COENG_STACK]);
  });

  it('divides as a real number rather than truncating accuracy to zero', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, cluster: COENG_STACK, correct: true },
      { cp: CP.KA, cluster: COENG_STACK, correct: false },
      { cp: CP.SA, cluster: SREY, correct: true },
      { cp: CP.SA, cluster: SREY, correct: true },
    ]);
    // Integer division would make both 0 and the order arbitrary.
    expect(rows(WORST_CLUSTERS, bind).map((r) => r.cluster)).toEqual([COENG_STACK, SREY]);
  });

  it('ignores keystrokes with no cluster attribution', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, cluster: null, correct: false },
      { cp: CP.KA, cluster: null, correct: false },
    ]);
    expect(rows(WORST_CLUSTERS, bind)).toEqual([]);
  });
});

describe('WORST_SUBSCRIPTS', () => {
  const bind = {
    $now: NOW,
    $halfLife: RECENCY_HALF_LIFE_MS,
    $minAttempts: 1,
    $limit: 10,
  };

  it('only counts subscript consonants', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.MO, subscript: true, correct: false },
      { cp: CP.KA, subscript: false, correct: false },
    ]);

    expect(rows(WORST_SUBSCRIPTS, bind).map((r) => r.codepoint)).toEqual([CP.MO]);
  });

  it('discounts an old mistake against a fresh one', () => {
    const old = addSession(NOW - 28 * DAY); // four half-lives back
    const fresh = addSession(NOW);
    addKeys(old, [{ cp: CP.MO, subscript: true, correct: false }]);
    addKeys(fresh, [{ cp: CP.RO, subscript: true, correct: false }]);

    // One error each, but the recent one must rank first.
    expect(rows(WORST_SUBSCRIPTS, bind).map((r) => r.codepoint)).toEqual([CP.RO, CP.MO]);
  });

  it('weights a mistake one half-life old at about half', () => {
    const s = addSession(NOW - 7 * DAY);
    addKeys(s, [{ cp: CP.MO, subscript: true, correct: false }]);
    expect(rows(WORST_SUBSCRIPTS, bind)[0]?.weightedErrors as number).toBeCloseTo(0.5, 2);
  });

  it('gives a correct keystroke no error weight at all', () => {
    const s = addSession(NOW);
    addKeys(s, [{ cp: CP.MO, subscript: true, correct: true }]);
    expect(rows(WORST_SUBSCRIPTS, bind)[0]?.weightedErrors).toBe(0);
  });
});

describe('SLOWEST_CODEPOINTS', () => {
  const bind = { $pauseCutoff: PAUSE_CUTOFF_MS, $minAttempts: 2, $limit: 10 };

  it('ranks the slowest target first', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.COENG, ms: 900 },
      { cp: CP.COENG, ms: 700 },
      { cp: CP.KA, ms: 120 },
      { cp: CP.KA, ms: 100 },
    ]);

    expect(rows(SLOWEST_CODEPOINTS, bind).map((r) => r.codepoint)).toEqual([CP.COENG, CP.KA]);
  });

  it('finds a slow key even when it is always typed correctly', () => {
    // The whole point of this query: hesitation is invisible to accuracy.
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.COENG, ms: 900, correct: true },
      { cp: CP.COENG, ms: 800, correct: true },
    ]);

    expect(rows(SLOWEST_CODEPOINTS, bind)[0]).toMatchObject({ attempts: 2, correct: 2 });
  });

  it('excludes the first keystroke of a run, which measures nothing', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, ms: 0 },
      { cp: CP.KA, ms: 200 },
      { cp: CP.KA, ms: 200 },
    ]);
    expect(rows(SLOWEST_CODEPOINTS, bind)[0]?.meanMs).toBe(200);
  });

  it('drops a pause long enough to be the user looking away', () => {
    const s = addSession(NOW);
    addKeys(s, [
      { cp: CP.KA, ms: 100 },
      { cp: CP.KA, ms: 100 },
      { cp: CP.KA, ms: 60_000 },
    ]);
    expect(rows(SLOWEST_CODEPOINTS, bind)[0]?.meanMs).toBe(100);
  });
});

describe('SESSION_TREND', () => {
  it('returns oldest first so it can be plotted left to right', () => {
    addSession(NOW - 2 * DAY, 100);
    addSession(NOW, 300);
    addSession(NOW - DAY, 200);

    expect(rows(SESSION_TREND, { $limit: 30 }).map((r) => r.cpm)).toEqual([100, 200, 300]);
  });

  it('keeps the most recent sessions when the limit bites, not the oldest', () => {
    for (let i = 1; i <= 5; i++) addSession(NOW - i * DAY, i * 10);
    expect(rows(SESSION_TREND, { $limit: 2 }).map((r) => r.cpm)).toEqual([20, 10]);
  });

  it('returns nothing before any session is recorded', () => {
    expect(rows(SESSION_TREND, { $limit: 30 })).toEqual([]);
  });
});
