import sqlite3InitModule, {
  type BindingSpec,
  type OpfsSAHPoolDatabase,
  type SAHPoolUtil,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import {
  ALL_KEYSTROKES,
  ALL_SESSIONS,
  DB_FILENAME,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  INSERT_KEYSTROKE,
  INSERT_SESSION,
  PRAGMAS,
  RECENT_SESSIONS,
  pendingMigrations,
  type ExportPayload,
  type KeystrokeRecord,
  type SessionRecord,
  type StoredSession,
} from './schema';
import {
  PAUSE_CUTOFF_MS,
  RECENCY_HALF_LIFE_MS,
  SESSION_TREND,
  SLOWEST_CODEPOINTS,
  WORST_CLUSTERS,
  WORST_SUBSCRIPTS,
} from './analytics';

/**
 * The database lives here and nowhere else.
 *
 * SQLite-WASM has to run in a Web Worker: the sahpool VFS takes synchronous
 * access handles, which would block the main thread. Everything crosses the
 * boundary as async messages.
 */

export type WorkerOp =
  | { op: 'saveSession'; session: SessionRecord; keystrokes: KeystrokeRecord[] }
  | { op: 'recentSessions'; limit: number }
  | { op: 'exportDatabase' }
  | { op: 'exportJson' }
  | { op: 'importExport'; data: ExportPayload }
  | { op: 'clearAllData' }
  | { op: 'worstClusters'; limit: number; minAttempts: number }
  | { op: 'worstSubscripts'; limit: number; minAttempts: number }
  | { op: 'slowestCodepoints'; limit: number; minAttempts: number }
  | { op: 'sessionTrend'; limit: number };

export type WorkerRequest = WorkerOp & { id: number };

export type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'fatal'; error: string }
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; error: string };

// A worker's postMessage takes one argument; the DOM lib types `self` as a
// Window, whose postMessage demands a targetOrigin. Narrow it rather than pull
// the WebWorker lib in, which would clash with DOM across the program.
const post = (message: WorkerResponse): void =>
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(message);

let sqlite3: Sqlite3Static;
let pool: SAHPoolUtil;
let db: OpfsSAHPoolDatabase;

/** Bring the file up to the current schema, one recorded step at a time. */
function migrate(): void {
  const [row] = db.exec({
    sql: 'PRAGMA user_version',
    rowMode: 'array',
    returnValue: 'resultRows',
  });
  const version = Number(row?.[0] ?? 0);

  for (const step of pendingMigrations(version)) {
    // Each step lands whole or not at all, so a failure cannot leave the file
    // half-migrated with a version that claims otherwise.
    db.transaction(() => {
      db.exec(step.sql);
      // PRAGMA takes no bound parameters. `step.version` is a loop index we
      // generated, never anything from outside.
      db.exec(`PRAGMA user_version = ${step.version}`);
    });
  }
}

function openDatabase(): void {
  db = new pool.OpfsSAHPoolDb(DB_FILENAME);
  db.exec(PRAGMAS); // per-connection, so it has to be reapplied on every open
  migrate();
}

async function connect(): Promise<void> {
  sqlite3 = await sqlite3InitModule();
  // sahpool over plain opfs: no COOP/COEP headers required, and faster.
  pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'knt-pool' });
  openDatabase();
}

function saveSession(session: SessionRecord, keystrokes: KeystrokeRecord[]): number {
  let sessionId = 0;

  // One transaction for the session and all its keystrokes: a half-written
  // session would quietly corrupt every Phase 5 statistic.
  db.transaction(() => {
    const inserted = db.exec({
      sql: INSERT_SESSION,
      bind: [
        session.startedAt,
        session.mode,
        session.durationMs,
        session.cpm,
        session.wpm,
        session.accuracy,
      ],
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    sessionId = Number(inserted[0]?.id);

    // Prepared once and re-bound: a test can be several hundred keystrokes, and
    // re-parsing the statement for each one is pure waste.
    const statement = db.prepare(INSERT_KEYSTROKE);
    try {
      for (const k of keystrokes) {
        statement
          .bind([
            sessionId,
            k.targetCodepoint,
            k.targetCluster,
            k.subscript ? 1 : 0,
            k.typedCodepoint,
            k.correct ? 1 : 0,
            k.msSincePrev,
          ])
          .step();
        statement.reset();
      }
    } finally {
      statement.finalize();
    }
  });

  return sessionId;
}

/** Assembles every session and its keystrokes into the F-02 JSON export shape. */
function buildExportPayload(): ExportPayload {
  const sessions = select(ALL_SESSIONS, []) as StoredSession[];
  const allKeystrokes = select(ALL_KEYSTROKES, []) as {
    sessionId: number;
    targetCodepoint: string | null;
    targetCluster: string | null;
    subscript: number;
    typedCodepoint: string;
    correct: number;
    msSincePrev: number;
  }[];

  const bySession = new Map<number, KeystrokeRecord[]>();
  for (const k of allKeystrokes) {
    const list = bySession.get(k.sessionId) ?? [];
    list.push({
      targetCodepoint: k.targetCodepoint,
      targetCluster: k.targetCluster,
      subscript: k.subscript === 1,
      typedCodepoint: k.typedCodepoint,
      correct: k.correct === 1,
      msSincePrev: k.msSincePrev,
    });
    bySession.set(k.sessionId, list);
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    sessions: sessions.map((s) => ({
      startedAt: s.startedAt,
      mode: s.mode,
      durationMs: s.durationMs,
      cpm: s.cpm,
      wpm: s.wpm,
      accuracy: s.accuracy,
      keystrokes: bySession.get(s.id) ?? [],
    })),
  };
}

/**
 * Replaces the entire history with a validated export. `data` has already
 * been through `parseExport()` on the caller side, so this only has to move
 * it into the database — every value still goes through bound parameters,
 * never string-built SQL.
 *
 * One transaction for the wipe and the reinsert: a failure partway through
 * (a full disk, a closed connection) must not leave the user with half their
 * old history and half their new one.
 */
function importExport(data: ExportPayload): void {
  db.transaction(() => {
    db.exec('DELETE FROM keystrokes');
    db.exec('DELETE FROM sessions');

    const statement = db.prepare(INSERT_KEYSTROKE);
    try {
      for (const session of data.sessions) {
        const inserted = db.exec({
          sql: INSERT_SESSION,
          bind: [
        session.startedAt,
        session.mode,
        session.durationMs,
        session.cpm,
        session.wpm,
        session.accuracy,
      ],
          rowMode: 'object',
          returnValue: 'resultRows',
        });
        const sessionId = Number(inserted[0]?.id);

        for (const k of session.keystrokes) {
          statement
            .bind([
              sessionId,
              k.targetCodepoint,
              k.targetCluster,
              k.subscript ? 1 : 0,
              k.typedCodepoint,
              k.correct ? 1 : 0,
              k.msSincePrev,
            ])
            .step();
          statement.reset();
        }
      }
    } finally {
      statement.finalize();
    }
  });
}

/**
 * F-06: drops the OPFS-backed file rather than deleting rows. A table-level
 * `DELETE` leaves the bytes sitting in the file until SQLite happens to reuse
 * that page — recoverable, which defeats the point of a "clear all my data"
 * control over data the review classifies as biometric.
 *
 * `pool.wipeFiles()` (not `unlink()`) is the one that actually matters here:
 * `unlink()` only disassociates a name from its slot in the pool, leaving the
 * slot's previous bytes in place until reused. `wipeFiles()` truncates every
 * slot's data back to its header, for real — see
 * `node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs`, `acquireAccessHandles`,
 * which is what `wipeFiles()` drives via `reset(true)`: `ah.truncate(HEADER_OFFSET_DATA)`
 * for every SAH. `removeVfs()` would be stronger still (deletes the OPFS
 * directory outright) but the API doc is explicit that the VFS cannot be
 * reused afterward without reloading the page, which would fail the "keeps
 * working without a reload" requirement here.
 */
async function clearAllData(): Promise<void> {
  // wipeFiles()'s behaviour is undefined against a handle still in use.
  db.close();
  try {
    await pool.wipeFiles();
  } finally {
    // Reopen either way: a failed wipe must not leave the app with no
    // database at all.
    openDatabase();
  }
}

const select = (sql: string, bind: BindingSpec): unknown =>
  db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });

function handle(request: WorkerRequest): unknown {
  switch (request.op) {
    case 'saveSession':
      return saveSession(request.session, request.keystrokes);
    case 'recentSessions':
      return select(RECENT_SESSIONS, [request.limit]);

    case 'worstClusters':
      return select(WORST_CLUSTERS, {
        $minAttempts: request.minAttempts,
        $limit: request.limit,
      });

    case 'worstSubscripts':
      return select(WORST_SUBSCRIPTS, {
        // Decay is measured from now, so the ranking shifts as mistakes age out.
        $now: Date.now(),
        $halfLife: RECENCY_HALF_LIFE_MS,
        $minAttempts: request.minAttempts,
        $limit: request.limit,
      });

    case 'slowestCodepoints':
      return select(SLOWEST_CODEPOINTS, {
        $pauseCutoff: PAUSE_CUTOFF_MS,
        $minAttempts: request.minAttempts,
        $limit: request.limit,
      });

    case 'sessionTrend':
      return select(SESSION_TREND, { $limit: request.limit });
    case 'exportDatabase': {
      // `pointer` goes undefined once a database is closed, which is briefly
      // true mid-import.
      const pointer = db.pointer;
      if (pointer === undefined) throw new Error('The database is not open.');
      return sqlite3.capi.sqlite3_js_db_export(pointer);
    }
    case 'exportJson':
      return buildExportPayload();
    case 'importExport':
      return importExport(request.data);
    case 'clearAllData':
      return clearAllData();
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    post({ kind: 'result', id: request.id, result: await handle(request) });
  } catch (e) {
    post({ kind: 'error', id: request.id, error: e instanceof Error ? e.message : String(e) });
  }
};

connect().then(
  () => post({ kind: 'ready' }),
  (e: unknown) => post({ kind: 'fatal', error: e instanceof Error ? e.message : String(e) }),
);
