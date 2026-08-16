import sqlite3InitModule, {
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
  SCHEMA,
  type KeystrokeRecord,
  type SessionRecord,
} from './schema';

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
  | { op: 'importDatabase'; bytes: Uint8Array };

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

function openDatabase(): void {
  db = new pool.OpfsSAHPoolDb(DB_FILENAME);
  db.exec(PRAGMAS); // per-connection, so it has to be reapplied on every open
  db.exec(SCHEMA);
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
          .bind([sessionId, k.targetCodepoint, k.typedCodepoint, k.correct ? 1 : 0, k.msSincePrev])
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

function handle(request: WorkerRequest): unknown {
  switch (request.op) {
    case 'saveSession':
      return saveSession(request.session, request.keystrokes);
    case 'recentSessions':
      return db.exec({
        sql: RECENT_SESSIONS,
        bind: [request.limit],
        rowMode: 'object',
        returnValue: 'resultRows',
      });
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
