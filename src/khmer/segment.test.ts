import { describe, expect, it } from 'vitest';
import { segment, standalone, stripInvisible } from './segment';
import { CLUSTER_CASES, CODEPOINTS, CP, LANGUAGE, LANGUAGE_ZWSP_KHMER } from './__fixtures__/khmer';

describe('fixture integrity', () => {
  // Guards against a bad paste or an editor re-encoding silently corrupting the
  // test data. A wrong glyph here would make every other test in the suite lie.
  for (const [name, expected] of Object.entries(CODEPOINTS)) {
    it(`CP.${name} is U+${expected.toString(16).toUpperCase().padStart(4, '0')}`, () => {
      const glyph = CP[name as keyof typeof CP];
      expect([...glyph]).toHaveLength(1);
      expect(glyph.codePointAt(0)).toBe(expected);
    });
  }
});

describe('segment', () => {
  for (const { name, text, clusters } of CLUSTER_CASES) {
    it(name, () => {
      expect(segment(text)).toEqual(clusters);
    });
  }

  it('is lossless — rejoining the clusters reproduces the input exactly', () => {
    // The codepoint-index -> cluster-index mapping in compare() is only valid if
    // segmentation drops nothing. This is what catches the missing dotAll flag.
    for (const { name, text } of CLUSTER_CASES) {
      expect(segment(text).join(''), name).toBe(text);
    }
  });
});

describe('stripInvisible', () => {
  it('removes the ZWSP word separator', () => {
    expect(stripInvisible(LANGUAGE_ZWSP_KHMER)).not.toContain(CP.ZWSP);
  });

  it('keeps every visible codepoint when removing ZWSP', () => {
    expect(stripInvisible(LANGUAGE + CP.ZWSP)).toBe(LANGUAGE);
  });

  it('leaves text containing no ZWSP untouched', () => {
    expect(stripInvisible(LANGUAGE)).toBe(LANGUAGE);
  });

  it('leaves ordinary spaces alone — they are typeable, ZWSP is not', () => {
    expect(stripInvisible(`${CP.KA} ${CP.KHA}`)).toBe(`${CP.KA} ${CP.KHA}`);
  });

  it('handles the empty string', () => {
    expect(stripInvisible('')).toBe('');
  });
});

describe('standalone', () => {
  it('gives a dependent vowel a dotted circle to sit on', () => {
    expect(standalone(CP.SRA_AA)).toBe('\u25CC' + CP.SRA_AA);
  });

  it('gives a coeng sequence one dotted circle, not one per codepoint', () => {
    // The R2 strip shows ្គ as a single cell, so only the leading mark decides.
    expect(standalone(CP.COENG + CP.KA)).toBe('\u25CC' + CP.COENG + CP.KA);
  });

  it('leaves a base consonant alone — it has nothing to attach to', () => {
    expect(standalone(CP.KA)).toBe(CP.KA);
  });

  it('handles the empty string', () => {
    expect(standalone('')).toBe('');
  });
});
