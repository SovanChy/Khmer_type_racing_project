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

export interface Settings {
  inputMode: InputMode;
}

const SETTINGS_KEY = 'knt.settings';

export const DEFAULT_SETTINGS: Settings = {
  // Remap is the default because it needs nothing installed on the machine.
  inputMode: 'remap',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    // localStorage is user-writable, so the parsed value is untrusted input:
    // validate rather than cast, or a hand-edited key can wedge the app.
    const parsed: unknown = JSON.parse(raw);
    const mode = (parsed as Partial<Settings> | null)?.inputMode;
    return { inputMode: mode === 'os' || mode === 'remap' ? mode : DEFAULT_SETTINGS.inputMode };
  } catch {
    // Private-window Safari and locked-down browsers throw on access, and a
    // corrupt value throws on parse. Reading a preference must never take the
    // app down.
    return DEFAULT_SETTINGS;
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
