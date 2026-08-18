/**
 * The single door to persisted state. Nothing outside this module talks to a
 * storage backend directly.
 *
 * Settings live in `localStorage`, not SQLite: they must be readable
 * synchronously before first paint, and a UI preference is not session data.
 * Phase 4 adds the SQLite-backed session and keystroke storage behind this same
 * module, so callers never learn which backend holds what.
 */
import type { InputMode } from '../keyboard/nida';
// `export { x as y } from` re-exports only — it does not bind a local name —
// so the database's clearAllData needs its own import to be callable below.
import { clearAllData as clearDatabase } from './db';

// Session history is SQLite in a Web Worker. Re-exported through this module so
// nothing outside `src/storage/` ever imports the worker or the schema directly.
export {
  exportDatabase,
  exportJson,
  importDatabase,
  initDatabase,
  onDbStatus,
  recentSessions,
  saveSession,
  sessionTrend,
  slowestCodepoints,
  worstClusters,
  worstSubscripts,
  type DbStatus,
} from './db';
export type { ExportPayload, KeystrokeRecord, SessionRecord, StoredSession } from './schema';
export type { ClusterStat, CodepointStat, SubscriptStat, TrendPoint } from './analytics';

export type Theme = 'light' | 'dark';

export interface Settings {
  inputMode: InputMode;
  theme: Theme;
}

const SETTINGS_KEY = 'knt.settings';

/** Dark unless the machine explicitly asks for light — this is a focus tool. */
function systemTheme(): Theme {
  const prefersLight =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

export function defaultSettings(): Settings {
  // Remap is the default input mode because it needs nothing installed.
  return { inputMode: 'remap', theme: systemTheme() };
}

export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return defaults;

    // localStorage is user-writable, so the parsed value is untrusted input:
    // validate each field rather than cast, or a hand-edited key wedges the app.
    const stored = JSON.parse(raw) as Partial<Settings> | null;
    return {
      inputMode: stored?.inputMode === 'os' || stored?.inputMode === 'remap'
        ? stored.inputMode
        : defaults.inputMode,
      theme: stored?.theme === 'light' || stored?.theme === 'dark' ? stored.theme : defaults.theme,
    };
  } catch {
    // Private-window Safari and locked-down browsers throw on access, and a
    // corrupt value throws on parse. Reading a preference must never take the
    // app down.
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled or full. The setting applies for this session and simply
    // will not survive a reload — not worth interrupting the user over.
  }
}

/**
 * F-06 "Clear all my data": the button says *all*, so this drops the OPFS
 * database (see `db.worker.ts` `clearAllData` for why a table `DELETE` isn't
 * enough) and removes the settings key, not just the session history.
 */
export async function clearAllData(): Promise<void> {
  await clearDatabase();
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Same reasoning as saveSettings(): storage access can throw, and a
    // preference surviving a "clear everything" click is not worth failing
    // the whole operation over when the database wipe already succeeded.
  }
}
