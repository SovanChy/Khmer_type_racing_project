import { useEffect, useRef, useState } from 'react';
import {
  clearAllData,
  exportDatabase,
  exportJson,
  importDatabase,
  onDbStatus,
  recentSessions,
  type DbStatus,
  type StoredSession,
} from './storage';

const button =
  'cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg hover:border-fg/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caret disabled:cursor-not-allowed disabled:opacity-40';

// Same shape as `button`, but red: this one is destructive and irreversible,
// and should not be reachable by the same absent-minded click as an export.
const dangerButton =
  'cursor-pointer rounded-md border border-error/40 px-3 py-1.5 text-sm text-error transition-colors hover:bg-error/10 hover:border-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:cursor-not-allowed disabled:opacity-40';

function save(bytes: Uint8Array<ArrayBuffer> | string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can cancel the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function DataPanel() {
  const [status, setStatus] = useState<DbStatus>('connecting');
  const [detail, setDetail] = useState<string>();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      onDbStatus((next, why) => {
        setStatus(next);
        setDetail(why);
      }),
    [],
  );

  useEffect(() => {
    if (status !== 'ready') return;
    recentSessions(5).then(setSessions, () => setSessions([]));
  }, [status, note]);

  async function onExportSqlite() {
    setNote(undefined);
    try {
      save(
        await exportDatabase(),
        `khmer-nida-trainer-${stamp()}.sqlite3`,
        'application/vnd.sqlite3',
      );
    } catch (e: unknown) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onExportJson() {
    setNote(undefined);
    try {
      save(
        JSON.stringify(await exportJson()),
        `khmer-nida-trainer-${stamp()}.json`,
        'application/json',
      );
    } catch (e: unknown) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onImport(file: File) {
    setNote(undefined);
    // Destructive and unrecoverable without the export they may not have taken.
    if (
      !confirm(
        `Replace your entire typing history with the sessions in "${file.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await importDatabase(await file.text());
      setNote({ kind: 'ok', text: 'History replaced.' });
    } catch (e: unknown) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onClear() {
    setNote(undefined);
    // Says plainly what goes and that it's final — this is the one control in
    // the panel that cannot be undone by re-importing an export the user might
    // not have taken.
    if (
      !confirm(
        'Delete all your typing history and settings from this device? ' +
          'This removes the local database file itself, not just its rows, and cannot be undone.',
      )
    ) {
      return;
    }
    try {
      await clearAllData();
      setNote({ kind: 'ok', text: 'All data cleared.' });
    } catch (e: unknown) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <section className="border-border space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Your data</h2>
        <StatusPill status={status} detail={detail} />
      </div>

      <p className="text-muted text-xs">
        Everything stays in this browser. OPFS can be evicted under storage pressure, so an export
        is the only real backup.
      </p>

      <div className="flex flex-wrap gap-2">
        <button onClick={onExportSqlite} disabled={status !== 'ready'} className={button}>
          Download my data (.sqlite3)
        </button>
        <button onClick={onExportJson} disabled={status !== 'ready'} className={button}>
          Download as JSON
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={status !== 'ready'}
          className={button}
        >
          Import a JSON export
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // so re-picking the same file fires again
            if (file) void onImport(file);
          }}
        />
        <button onClick={onClear} disabled={status !== 'ready'} className={dangerButton}>
          Clear all my data
        </button>
      </div>

      {note && (
        <p className={`text-xs ${note.kind === 'error' ? 'text-error' : 'text-muted'}`} role="status">
          {note.text}
        </p>
      )}

      {sessions.length > 0 && (
        <ol className="text-muted space-y-1 font-mono text-xs">
          {sessions.map((s) => (
            <li key={s.id}>
              {new Date(s.startedAt).toLocaleString()} · {s.mode} · {Math.round(s.cpm)} cpm ·{' '}
              {Math.round(s.accuracy * 100)}%
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StatusPill({ status, detail }: { status: DbStatus; detail?: string }) {
  if (status === 'ready') return <span className="text-muted text-xs">Ready</span>;
  if (status === 'connecting') return <span className="text-muted text-xs">Connecting…</span>;

  const text =
    status === 'locked'
      ? 'Already open in another tab — this tab will connect when that one closes.'
      : `Database unavailable${detail ? `: ${detail}` : ''}. Your results will not be saved.`;

  return (
    <span role="alert" className="text-xs text-amber-700 dark:text-amber-300">
      {text}
    </span>
  );
}
