import { describe, expect, it } from 'vitest';
import { fromNida, isModifier, keyFor, ROWS, type LayoutSource } from './layout';
import { NIDA, type NidaTable } from './nida';
import { CP } from '../khmer/__fixtures__/khmer';

/**
 * A small hand-written source, never `nida.json`: these tests must keep
 * passing unchanged once the real verified layout lands. CP.KA is
 * deliberately reachable two ways -- base on KeyQ, shift on KeyW -- to test
 * that base wins the tie.
 */
const TABLE: LayoutSource = {
  KeyQ: { base: CP.KA, shift: CP.KHA, altgr: CP.NO },
  KeyW: { base: CP.MO, shift: CP.KA },
};

describe('keyFor', () => {
  it('resolves a base-layer codepoint', () => {
    expect(keyFor(CP.MO, TABLE)).toEqual({ code: 'KeyW', layer: 'base' });
  });

  it('resolves a shift-layer codepoint', () => {
    expect(keyFor(CP.KHA, TABLE)).toEqual({ code: 'KeyQ', layer: 'shift' });
  });

  it('resolves an altgr-layer codepoint', () => {
    expect(keyFor(CP.NO, TABLE)).toEqual({ code: 'KeyQ', layer: 'altgr' });
  });

  it('prefers base over shift when a codepoint is reachable both ways', () => {
    // CP.KA sits on KeyQ.base and KeyW.shift -- the unmodified key must win.
    expect(keyFor(CP.KA, TABLE)).toEqual({ code: 'KeyQ', layer: 'base' });
  });

  it('special-cases space, which nida.json deliberately omits', () => {
    // Shift, not base: on NiDA a real space is Shift+Space, so the hint has to
    // light the Shift keys alongside the space bar. Lighting the bar alone
    // teaches a keypress that does not produce the character being asked for.
    expect(keyFor(' ', TABLE)).toEqual({ code: 'Space', layer: 'shift' });
  });

  it('returns null for an unmapped codepoint', () => {
    expect(keyFor(CP.SA, TABLE)).toBeNull();
  });

  it('never resolves a modifier code, for any codepoint in the source', () => {
    // ShiftLeft/ShiftRight/AltRight never appear as keys in a LayoutSource --
    // this walks every mapped codepoint in NIDA_LAYOUT-shaped tables and
    // checks the reverse lookup can't accidentally land on one.
    for (const code of Object.keys(TABLE)) {
      for (const layer of ['base', 'shift', 'altgr'] as const) {
        const cp = TABLE[code]?.[layer];
        if (!cp) continue;
        expect(isModifier(keyFor(cp, TABLE)!.code)).toBe(false);
      }
    }
  });
});

describe('isModifier', () => {
  it('is true for the shift and altgr keys', () => {
    expect(isModifier('ShiftLeft')).toBe(true);
    expect(isModifier('ShiftRight')).toBe(true);
    expect(isModifier('AltRight')).toBe(true);
  });

  it('is false for Space -- it is a real target key, not a modifier', () => {
    expect(isModifier('Space')).toBe(false);
  });

  it('is false for an ordinary letter key', () => {
    expect(isModifier('KeyQ')).toBe(false);
  });
});

describe('fromNida', () => {
  it('drops null layers rather than carrying them through', () => {
    const table: NidaTable = {
      verified: true,
      keys: {
        KeyQ: { base: CP.KA, shift: CP.KHA, altgr: null },
      },
    };
    expect(fromNida(table)).toEqual({
      KeyQ: { base: CP.KA, shift: CP.KHA },
    });
  });
});

describe('ROWS', () => {
  it('draws every key position the current NIDA table maps', () => {
    // The geometry guard: catches a future verified table that maps a key
    // this diagram has no cell for.
    const flat = new Set(ROWS.flat());
    for (const code of Object.keys(NIDA.keys)) {
      expect(flat.has(code), `${code} is in NIDA.keys but not in ROWS`).toBe(true);
    }
  });
});
