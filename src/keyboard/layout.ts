import { NIDA, type NidaTable } from './nida';

export type Layer = 'base' | 'shift' | 'altgr';

/** code -> what that key produces per layer. A missing entry means unknown. */
export type LayoutSource = Record<string, Partial<Record<Layer, string>>>;

/**
 * US-ANSI keyboard GEOMETRY -- where each physical key sits, not what it types.
 * This is not NiDA data and invents no mapping, so it does not fall under
 * CLAUDE.md's "never generate NiDA mappings" rule: a row of `Backquote`,
 * `Digit1`... is true of every US-ANSI keyboard regardless of layout.
 */
export const ROWS: readonly (readonly string[])[] = [
  [
    'Backquote',
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
    'Digit0',
    'Minus',
    'Equal',
  ],
  [
    'KeyQ',
    'KeyW',
    'KeyE',
    'KeyR',
    'KeyT',
    'KeyY',
    'KeyU',
    'KeyI',
    'KeyO',
    'KeyP',
    'BracketLeft',
    'BracketRight',
    'Backslash',
  ],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  [
    'ShiftLeft',
    'KeyZ',
    'KeyX',
    'KeyC',
    'KeyV',
    'KeyB',
    'KeyN',
    'KeyM',
    'Comma',
    'Period',
    'Slash',
    'ShiftRight',
  ],
  ['Space', 'AltRight'],
];

/** Display text for a modifier cell -- these never carry a Khmer glyph. */
export const MODIFIER_LABEL: Record<string, string> = {
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  AltRight: 'AltGr',
  Space: 'Space',
};

/**
 * True for the keys that only ever change which layer a LETTER produces --
 * never a target in their own right. `Space` is deliberately NOT one of
 * these: it types an actual codepoint (`keyFor(' ')` resolves to it), so it
 * must still be highlightable as a normal target key, just with no Khmer
 * glyph to show on its cap.
 */
export function isModifier(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight' || code === 'AltRight';
}

const LAYERS: readonly Layer[] = ['base', 'shift', 'altgr'];

/** Turns a `NidaTable` into a `LayoutSource`, dropping the `null` layers. */
export function fromNida(table: NidaTable): LayoutSource {
  const source: LayoutSource = {};
  for (const [code, mapping] of Object.entries(table.keys)) {
    const entry: Partial<Record<Layer, string>> = {};
    for (const layer of LAYERS) {
      const cp = mapping[layer];
      if (cp) entry[layer] = cp;
    }
    source[code] = entry;
  }
  return source;
}

// Built once for the table remap mode actually uses.
export const NIDA_LAYOUT: LayoutSource = fromNida(NIDA);

/**
 * Reverse-lookup: which key, on which layer, produces `cp`?
 *
 * The space bar is a special case because it is deliberately absent from
 * nida.json -- see `resolveKey` in `nida.ts` -- so without this the hint would
 * go blank at every word boundary.
 *
 * A plain linear scan, layer-major (all keys' base, then all keys' shift,
 * then all keys' altgr) so a codepoint reachable without a modifier is always
 * taught that way, and only the first key wins within a layer on a genuine
 * tie. A full table is ~50 keys x 3 layers, so this is ~150 comparisons --
 * far cheaper than the cached-index machinery it replaces, and `source` can
 * now change at runtime (the observed layout grows key by key as the user
 * types), which a cache would have to invalidate correctly to stay honest.
 */
export function keyFor(cp: string, source: LayoutSource): { code: string; layer: Layer } | null {
  // No modifier-code guard needed here: ShiftLeft/ShiftRight/AltRight never
  // appear as keys in a LayoutSource (nida.json and the observed layout both
  // key by the letter/digit/punctuation position a layer applies TO, not by
  // the modifier itself), so this scan can never return one.
  // Space is the one key nida.json does not cover: the ToUnicodeEx dump reads
  // letter, digit and punctuation positions, and never captured the space bar.
  // On NiDA a real U+0020 is Shift+Space -- reported by the user against their
  // installed layout, not measured, which is why it lives here as a stated
  // assumption rather than as a hand-written row in a file whose whole claim is
  // that nothing in it was typed from memory. The hint teaches Shift+Space; the
  // input stays lenient about it (see `resolveKey`).
  if (cp === ' ') return { code: 'Space', layer: 'shift' };
  for (const layer of LAYERS) {
    for (const code of Object.keys(source)) {
      if (source[code]?.[layer] === cp) return { code, layer };
    }
  }
  return null;
}
