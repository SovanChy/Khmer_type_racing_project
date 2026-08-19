import { describe, expect, it } from 'vitest';
import { KHMER_CODEPOINT, NIDA, TYPING_KEY_CODES, resolveKey, type KeyEventLike, type NidaTable } from './nida';
import { CP } from '../khmer/__fixtures__/khmer';

/**
 * Resolution is tested against this fixed table, never against `nida.json`, so
 * these tests keep passing unchanged when the real verified layout lands.
 */
const TABLE: NidaTable = {
  verified: true,
  keys: {
    KeyQ: { base: CP.KA, shift: CP.KHA, altgr: CP.NO },
    KeyW: { base: CP.SA, shift: CP.RO, altgr: null },
  },
};

/** Render a codepoint as U+XXXX — a raw Khmer glyph in a failure message is unreadable. */
const u = (s: string) =>
  [...s].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: '',
  code: '',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  getModifierState: () => false,
  ...over,
});

/** Windows reports AltGr as ctrl+alt, so a realistic AltGr event sets all three. */
const altGr = (over: Partial<KeyEventLike>): KeyEventLike =>
  ev({ ctrlKey: true, altKey: true, getModifierState: (k) => k === 'AltGraph', ...over });

describe('nida.json', () => {
  it('is marked unverified until the real NiDA layout is supplied', () => {
    // Flipping this to true is the deliberate act of vouching for the table.
    // If this test fails, the table was verified — delete this test.
    expect(NIDA.verified).toBe(false);
  });

  it('maps only key positions that can produce a character', () => {
    for (const code of Object.keys(NIDA.keys)) {
      expect(TYPING_KEY_CODES, `${code} is not a typing KeyboardEvent.code`).toContain(code);
    }
  });

  /**
   * This assertion used to demand exactly one codepoint per layer, because
   * SPEC.md Phase 1 states "one NiDA keypress emits exactly one codepoint".
   * The real layout disproves it: five keys are ligatures that emit a base
   * vowel plus a combining mark in a single press (KeyA.shift = ាំ, and see
   * the others in nida.json). The rule that survives is narrower — a pair is
   * only ever a character followed by a combining mark, never two unrelated
   * codepoints stuffed into one key.
   */
  it('maps every layer to one codepoint, or a codepoint plus a combining mark', () => {
    for (const [code, mapping] of Object.entries(NIDA.keys)) {
      for (const [layer, cp] of Object.entries(mapping)) {
        if (cp === null) continue;
        const cps = [...cp];
        expect(cps.length, `${code}.${layer} = ${u(cp)} is more than a ligature`)
          .toBeLessThanOrEqual(2);
        if (cps.length === 2) {
          expect(/\p{M}/u.test(cps[1]), `${code}.${layer} = ${u(cp)} is not base + mark`).toBe(true);
        }
      }
    }
  });

  /**
   * Also weakened against reality: NiDA genuinely puts non-Khmer characters on
   * the keyboard — «» on Backquote, ZWJ/ZWNJ on the AltGr layer, and ASCII
   * punctuation across the digit row. Demanding Khmer everywhere was wrong.
   *
   * What must still never appear is a Latin letter or digit: that is the
   * signature of a table captured from the wrong active layout (KeyQ = "q"),
   * which is the mistake that silently teaches an entire wrong keyboard.
   */
  it('never maps a layer to a Latin letter or digit', () => {
    for (const [code, mapping] of Object.entries(NIDA.keys)) {
      for (const [layer, cp] of Object.entries(mapping)) {
        if (cp === null) continue;
        expect(/[A-Za-z0-9]/.test(cp), `${code}.${layer} = ${u(cp)} is Latin — wrong layout?`)
          .toBe(false);
      }
    }
  });

  it('maps at least one Khmer codepoint on every letter key', () => {
    // The complement of the test above: a table that is merely punctuation
    // would pass "no Latin" while teaching nothing.
    for (const [code, mapping] of Object.entries(NIDA.keys)) {
      if (!code.startsWith('Key')) continue;
      const layers = Object.values(mapping).filter((cp): cp is string => cp !== null);
      expect(layers.some((cp) => KHMER_CODEPOINT.test(cp.charAt(0))), `${code} has no Khmer`).toBe(true);
    }
  });

  it('never maps the same codepoint twice', () => {
    const seen = new Map<string, string>();
    for (const [code, mapping] of Object.entries(NIDA.keys)) {
      for (const [layer, cp] of Object.entries(mapping)) {
        if (cp === null) continue;
        expect(seen.get(cp), `${u(cp)} is on both ${seen.get(cp)} and ${code}.${layer}`)
          .toBeUndefined();
        seen.set(cp, `${code}.${layer}`);
      }
    }
  });
});

describe('resolveKey — shared behaviour', () => {
  it.each(['remap', 'os'] as const)('treats Backspace as an edit, not a character (%s)', (mode) => {
    expect(resolveKey(ev({ key: 'Backspace', code: 'Backspace' }), mode, TABLE)).toEqual({
      type: 'backspace',
    });
  });

  it.each(['remap', 'os'] as const)('ignores browser shortcuts like ctrl+c (%s)', (mode) => {
    expect(resolveKey(ev({ key: 'c', code: 'KeyQ', ctrlKey: true }), mode, TABLE)).toEqual({
      type: 'ignore',
    });
  });

  it.each(['remap', 'os'] as const)('ignores meta combos (%s)', (mode) => {
    expect(resolveKey(ev({ key: 'a', code: 'KeyQ', metaKey: true }), mode, TABLE)).toEqual({
      type: 'ignore',
    });
  });

  it.each(['remap', 'os'] as const)('ignores bare modifier keypresses (%s)', (mode) => {
    expect(resolveKey(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), mode, TABLE)).toEqual({
      type: 'ignore',
    });
  });
});

describe('resolveKey — remap mode', () => {
  it('reads the base layer by physical position', () => {
    expect(resolveKey(ev({ code: 'KeyQ' }), 'remap', TABLE)).toEqual({ type: 'char', cp: CP.KA });
  });

  it('reads the shift layer', () => {
    expect(resolveKey(ev({ code: 'KeyQ', shiftKey: true }), 'remap', TABLE)).toEqual({
      type: 'char',
      cp: CP.KHA,
    });
  });

  it('reads the altgr layer even though Windows reports AltGr as ctrl+alt', () => {
    // The whole third layer is unreachable if ctrl+alt is rejected as a shortcut.
    expect(resolveKey(altGr({ code: 'KeyQ' }), 'remap', TABLE)).toEqual({
      type: 'char',
      cp: CP.NO,
    });
  });

  it('ignores the OS layout entirely and uses the physical key', () => {
    // A user with the Khmer layout installed AND remap mode on: e.key is already
    // Khmer, but the position is what must decide.
    expect(resolveKey(ev({ key: CP.SRA_AA, code: 'KeyQ' }), 'remap', TABLE)).toEqual({
      type: 'char',
      cp: CP.KA,
    });
  });

  it('ignores a key position that is not in the table', () => {
    expect(resolveKey(ev({ code: 'KeyP' }), 'remap', TABLE)).toEqual({ type: 'ignore' });
  });

  it('ignores a layer that is mapped to null', () => {
    expect(resolveKey(altGr({ code: 'KeyW' }), 'remap', TABLE)).toEqual({ type: 'ignore' });
  });

  it('produces a real space for the space bar, which the table does not cover', () => {
    expect(resolveKey(ev({ key: ' ', code: 'Space' }), 'remap', TABLE)).toEqual({
      type: 'char',
      cp: ' ',
    });
  });

  it('ignores navigation keys', () => {
    expect(resolveKey(ev({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'remap', TABLE)).toEqual({
      type: 'ignore',
    });
  });
});

describe('resolveKey — OS layout mode', () => {
  it('takes the character the OS layout already produced', () => {
    expect(resolveKey(ev({ key: CP.SRA_AA, code: 'KeyQ' }), 'os', TABLE)).toEqual({
      type: 'char',
      cp: CP.SRA_AA,
    });
  });

  it('ignores our own table in this mode', () => {
    expect(resolveKey(ev({ key: CP.SRA_AA, code: 'KeyQ' }), 'os', TABLE)).not.toEqual({
      type: 'char',
      cp: CP.KA,
    });
  });

  it('accepts a shifted character as whatever the OS produced', () => {
    expect(resolveKey(ev({ key: CP.NIKAHIT, code: 'KeyQ', shiftKey: true }), 'os', TABLE)).toEqual({
      type: 'char',
      cp: CP.NIKAHIT,
    });
  });

  it('passes the space bar through', () => {
    expect(resolveKey(ev({ key: ' ', code: 'Space' }), 'os', TABLE)).toEqual({
      type: 'char',
      cp: ' ',
    });
  });

  it('ignores named keys such as Enter and Tab', () => {
    expect(resolveKey(ev({ key: 'Enter', code: 'Enter' }), 'os', TABLE)).toEqual({ type: 'ignore' });
    expect(resolveKey(ev({ key: 'Tab', code: 'Tab' }), 'os', TABLE)).toEqual({ type: 'ignore' });
  });

  it('treats a multi-codepoint key value as not a character', () => {
    expect(resolveKey(ev({ key: 'Dead', code: 'Backquote' }), 'os', TABLE)).toEqual({
      type: 'ignore',
    });
  });
});
