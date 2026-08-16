import {
  looksLikeSqlite,
  type KeystrokeRecord,
  type SessionRecord,
  type StoredSession,
} from './schema';
import type { WorkerOp, WorkerRequest, WorkerResponse } from './db.worker';
import type { ClusterStat, CodepointStat, SubscriptStat, TrendPoint } from './analytics';

export type DbStatus =
  | 'connecting'
  | 'locked' // another tab holds the database
  | 'ready'
  | 'unavailable'; // no OPFS, or the worker failed to start

/**
 * The sahpool VFS is explicitly not multi-tab safe, so exactly one tab may hold
 * the database. Web Locks does that without a race: the second tab simply
 * queues, and the browser hands it the lock when the first tab closes or
 * crashes. A BroadcastChannel ping/pong cannot manage either property.
 */
const LOCK_NAME = 'khmer-nida-trainer-db';

/** Not acquired this quickly means someone else is holding it. */
const LOCK_PROBE_MS = 150;

let status: DbStatus = 'connecting';
let detail: string | undefined;
const listeners = new Set<(status: DbStatus, detail?: string) => void>();

function setStatus(next: DbStatus, nextDetail?: string): void {
  status = next;
  detail = nextDetail;
  for (const listener of listeners) listener(status, detail);
}

/** Subscribe to connection state. Fires immediately with the current value. */
export function onDbStatus(listener: (status: DbStatus, detail?: string) => void): () => void {
  listeners.add(listener);
  listener(status, detail);
  return () => listeners.delete(listener);
}

/** Hold the lock for as long as this tab lives; the browser releases it for us. */
function holdLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve();

  return new Promise((acquired) => {
    void navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, () => {
      acquired();
      return new Promise<never>(() => {}); // never resolves — that is the point
    });
  });
}

let connection: Promise<Worker> | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

async function connect(): Promise<Worker> {
  const probe = setTimeout(() => {
    if (status === 'connecting') setStatus('locked');
  }, LOCK_PROBE_MS);

  await holdLock();
  clearTimeout(probe);
  setStatus('connecting'); // clears a 'locked' notice if we had queued behind a tab

  return new Promise<Worker>((resolve, reject) => {
    const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });

    const fail = (message: string) => {
      setStatus('unavailable', message);
      for (const p of pending.values()) p.reject(new Error(message));
      pending.clear();
      reject(new Error(message));
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'ready') {
        setStatus('ready');
        resolve(worker);
        return;
      }
      if (message.kind === 'fatal') {
        fail(message.error);
        return;
      }

      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.kind === 'result') waiting.resolve(message.result);
      else waiting.reject(new Error(message.error));
    };

    worker.onerror = (event) => fail(event.message || 'The database worker failed to start.');
  });
}

/** Start connecting (and claim the lock) without waiting for a first query. */
export function initDatabase(): void {
  connection ??= connect().catch((e: unknown) => {
    // Swallowed here so an unavailable database does not become an unhandled
    // rejection; `status` already carries the failure, and call() rethrows.
    connection = null;
    throw e;
  });
}

async function call<T>(request: WorkerOp): Promise<T> {
  connection ??= connect();
  const worker = await connection;
  const id = ++sequence;

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ ...request, id } as WorkerRequest);
  });
}

export const saveSession = (session: SessionRecord, keystrokes: KeystrokeRecord[]): Promise<number> =>
  call<number>({ op: 'saveSession', session, keystrokes });

export const recentSessions = (limit = 30): Promise<StoredSession[]> =>
  call<StoredSession[]>({ op: 'recentSessions', limit });

// Explicitly ArrayBuffer-backed, not ArrayBufferLike: structured clone cannot
// carry a SharedArrayBuffer here, and Blob/File APIs reject the wider type.
export const exportDatabase = (): Promise<Uint8Array<ArrayBuffer>> =>
  call<Uint8Array<ArrayBuffer>>({ op: 'exportDatabase' });

/**
 * Rarely-seen targets are excluded from every ranking: one miss out of one
 * attempt is 0% accuracy and would otherwise sit at the top of the list forever.
 */
const MIN_ATTEMPTS = 5;

export const worstClusters = (limit = 10, minAttempts = MIN_ATTEMPTS): Promise<ClusterStat[]> =>
  call<ClusterStat[]>({ op: 'worstClusters', limit, minAttempts });

export const worstSubscripts = (limit = 8, minAttempts = MIN_ATTEMPTS): Promise<SubscriptStat[]> =>
  call<SubscriptStat[]>({ op: 'worstSubscripts', limit, minAttempts });

export const slowestCodepoints = (limit = 8, minAttempts = MIN_ATTEMPTS): Promise<CodepointStat[]> =>
  call<CodepointStat[]>({ op: 'slowestCodepoints', limit, minAttempts });

export const sessionTrend = (limit = 30): Promise<TrendPoint[]> =>
  call<TrendPoint[]>({ op: 'sessionTrend', limit });

export async function importDatabase(bytes: Uint8Array): Promise<void> {
  // Checked before it crosses the boundary: an import replaces the user's whole
  // history, so a wrong file should fail with a sentence they can act on rather
  // than whatever the VFS throws.
  if (!looksLikeSqlite(bytes)) {
    throw new Error('That file is not a SQLite database.');
  }
  await call<void>({ op: 'importDatabase', bytes });
}
