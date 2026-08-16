import sqlite3InitModule, {
  type BindingSpec,
  type OpfsSAHPoolDatabase,
  type SAHPoolUtil,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import {
  DB_FILENAME,
  INSERT_KEYSTROKE,
  INSERT_SESSION,
  PRAGMAS,
  RECENT_SESSIONS,
  pendingMigrations,
  type KeystrokeRecord,
  type SessionRecord,
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
  | { op: 'importDatabase'; bytes: Uint8Array }
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
      bind: [session.startedAt, session.mode, session.durationMs, session.cpm, session.accuracy],
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

async function importDatabase(bytes: Uint8Array): Promise<void> {
  // The pool cannot overwrite a file that is currently open.
  db.close();
  try {
    await pool.importDb(DB_FILENAME, bytes);
  } finally {
    // Reopen either way: a rejected import must not leave the app with no
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
    case 'importDatabase':
      return importDatabase(request.bytes);
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
