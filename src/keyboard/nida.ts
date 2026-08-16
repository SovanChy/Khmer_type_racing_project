import table from './nida.json';

export type InputMode =
  | 'remap' // we map physical key position ourselves; works with no install
  | 'os'; // the user has the system NiDA layout; trust what it produced

export interface KeyMapping {
  base: string | null;
  shift: string | null;
  altgr: string | null;
}

export interface NidaTable {
  /** False until a human has vouched for `keys` against the official layout. */
  verified: boolean;
  /** Keyed by `KeyboardEvent.code` — physical position, not the OS layout. */
  keys: Record<string, KeyMapping>;
}

export type KeyAction =
  | { type: 'char'; cp: string }
  | { type: 'backspace' }
  | { type: 'ignore' };

/** The part of `KeyboardEvent` we read. Narrow so tests need no DOM. */
export interface KeyEventLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  getModifierState(key: string): boolean;
}

export const NIDA: NidaTable = table;

/**
 * Assigned codepoints in the Khmer block: letters and signs (U+1780-U+17DD),
 * digits (U+17E0-U+17E9) and lek attak numerals (U+17F0-U+17F9). The gaps at
 * U+17DE-U+17DF, U+17EA-U+17EF and U+17FA-U+17FF are unassigned and must never
 * appear in the table.
 */
export const KHMER_CODEPOINT = /^[\u1780-\u17DD\u17E0-\u17E9\u17F0-\u17F9]$/u;

/**
 * Key positions that can carry a character on a standard keyboard. Guards the
 * table against entries like "Q" or "ShiftLeft" that would never match a real
 * `KeyboardEvent.code`.
 */
export const TYPING_KEY_CODES: readonly string[] = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'IntlBackslash', // present on many non-US physical keyboards
  'IntlRo',
  'IntlYen',
  'Space',
];

/**
 * Turn a keydown into the one thing it should do.
 *
 * Only 'char' and 'backspace' should be `preventDefault()`ed by the caller --
 * swallowing everything would trap keyboard users, who need Tab and Escape to
 * leave the field.
 */
export function resolveKey(
  e: KeyEventLike,
  mode: InputMode,
  layout: NidaTable = NIDA,
): KeyAction {
  if (e.key === 'Backspace') return { type: 'backspace' };

  // Windows reports AltGr as ctrl+alt, so AltGraph must be checked BEFORE
  // rejecting modifier combos -- otherwise the whole third layer is
  // unreachable. Real ctrl/meta chords still fall through to the browser.
  const altGraph = e.getModifierState('AltGraph');
  if (!altGraph && (e.ctrlKey || e.metaKey || e.altKey)) return { type: 'ignore' };

  if (mode === 'os') {
    // The OS already applied the layout; e.key holds the character it produced.
    // Named keys ('Enter', 'Dead', ...) are longer than a single codepoint.
    return [...e.key].length === 1 ? { type: 'char', cp: e.key } : { type: 'ignore' };
  }

  const layer = altGraph ? 'altgr' : e.shiftKey ? 'shift' : 'base';
  const cp = layout.keys[e.code]?.[layer];
  if (cp) return { type: 'char', cp };

  // The space bar produces a space in every layer, so it stays out of the table.
  if (e.code === 'Space') return { type: 'char', cp: ' ' };
  return { type: 'ignore' };
}
