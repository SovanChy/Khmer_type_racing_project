import { describe, expect, it } from 'vitest';
import { buildIndex, foldWord, lookupIn, lookupWord, type Packed } from './index';
import {
  CP,
  HELLO_COENG_DA,
  HELLO_COENG_TA,
  KHMER,
  LANGUAGE,
  LANGUAGE_ZWSP_KHMER,
} from '../khmer/__fixtures__/khmer';

/**
 * Stand-in definitions. What they say does not matter; that the Khmer one is
 * Khmer does — a definition is displayed with `lang="km"` and the Khmer font.
 */
const KH_DEFINITION = LANGUAGE_ZWSP_KHMER;
const EN_GLOSS = '(intj) hello';

describe('foldWord', () => {
  it('folds subscript ដ to subscript ត so both spellings share a key', () => {
    expect(foldWord(HELLO_COENG_DA)).toBe(foldWord(HELLO_COENG_TA));
  });

  it('strips the khan a word carries out of a passage', () => {
    expect(foldWord(LANGUAGE + CP.KHAN)).toBe(LANGUAGE);
  });

  it('strips the zero-width space corpus text is separated by', () => {
    expect(foldWord(CP.ZWSP + LANGUAGE + CP.ZWSP)).toBe(LANGUAGE);
  });

  it('leaves an ordinary word alone', () => {
    expect(foldWord(KHMER)).toBe(KHMER);
  });
});

describe('lookupIn', () => {
  const dict = buildIndex({
    [HELLO_COENG_DA]: [KH_DEFINITION, EN_GLOSS],
    [LANGUAGE]: [KH_DEFINITION, '(noun) language'],
    [KHMER]: ['', '(name) Khmer'],
  });

  it('finds a word spelled with the other subscript', () => {
    // The whole point of the fold: this is what a NiDA keyboard produces, and
    // it is not how the 1967 dictionary spells it.
    expect(lookupIn(dict, HELLO_COENG_TA)?.en).toBe(EN_GLOSS);
  });

  it('finds a word that arrives with punctuation attached', () => {
    expect(lookupIn(dict, LANGUAGE + CP.KHAN)?.kh).toBe(KH_DEFINITION);
  });

  it('reports a missing Khmer definition as absent, not as an empty string', () => {
    // Wiktionary covers proper nouns that a monolingual dictionary never had,
    // so an English-only entry is normal and the panel must not render a blank.
    expect(lookupIn(dict, KHMER)).toEqual({ word: KHMER, kh: undefined, en: '(name) Khmer' });
  });

  it('returns null for a word that is in neither source', () => {
    expect(lookupIn(dict, CP.KA + CP.KHA)).toBe(null);
  });

  it('returns null for punctuation with no word in it', () => {
    expect(lookupIn(dict, CP.KHAN)).toBe(null);
  });
});

describe('lookupWord', () => {
  const dict = buildIndex({
    [LANGUAGE]: [KH_DEFINITION, '(noun) language'],
    [KHMER]: ['', '(name) Khmer'],
  });

  it('returns the one entry when the word is a headword', () => {
    expect(lookupWord(dict, LANGUAGE).map((e) => e.word)).toEqual([LANGUAGE]);
  });

  it('splits a compound the segmenter kept together', () => {
    // ភាសាខ្មែរ is one segment to Intl.Segmenter and two headwords here, which
    // is why tapping it used to answer "no entry" for a word made entirely of
    // words that have definitions.
    expect(lookupWord(dict, LANGUAGE + KHMER).map((e) => e.word)).toEqual([LANGUAGE, KHMER]);
  });

  it('steps over a numeral instead of failing on it', () => {
    // UAX #29 refuses to break between a letter and a digit, so ឆ្នាំ២០២៦ arrives
    // as one word. A number needs no definition; the words around it do.
    const digits = CP.DIGIT_ONE + CP.DIGIT_ONE;
    expect(lookupWord(dict, LANGUAGE + digits + KHMER).map((e) => e.word)).toEqual([
      LANGUAGE,
      KHMER,
    ]);
  });

  it('answers nothing when any piece has no definition', () => {
    // Half an answer is worse than none: a proper noun that happens to start
    // with a real word would otherwise be explained as something it is not.
    expect(lookupWord(dict, LANGUAGE + CP.KA + CP.KHA)).toEqual([]);
  });

  it('never proposes a split inside a cluster', () => {
    // The scan walks clusters, so a coeng stack is indivisible even when its
    // first consonant is a headword on its own.
    const stacked = buildIndex({ [CP.KA]: ['', '(letter) ka'], [KHMER]: ['', '(name) Khmer'] });
    expect(lookupWord(stacked, CP.KA + CP.COENG + CP.KA)).toEqual([]);
  });
});

describe('buildIndex', () => {
  it('merges the two spellings of a word instead of letting one win', () => {
    // Both are real entries in dict.json: Chuon Nath catalogues the Khmer
    // definition under coeng ដ, Wiktionary the English gloss under coeng ត.
    // They fold to one key, and dropping either loses half the answer.
    const merged = lookupIn(
      buildIndex({
        [HELLO_COENG_DA]: [KH_DEFINITION],
        [HELLO_COENG_TA]: ['', EN_GLOSS],
      }),
      HELLO_COENG_TA,
    );

    expect(merged?.kh).toBe(KH_DEFINITION);
    expect(merged?.en).toBe(EN_GLOSS);
  });

  it('merges the same pair whichever order the file lists them in', () => {
    const reversed = lookupIn(
      buildIndex({
        [HELLO_COENG_TA]: ['', EN_GLOSS],
        [HELLO_COENG_DA]: [KH_DEFINITION],
      }),
      HELLO_COENG_DA,
    );

    expect(reversed?.kh).toBe(KH_DEFINITION);
    expect(reversed?.en).toBe(EN_GLOSS);
  });

  it('drops an entry whose headword is only punctuation', () => {
    expect(buildIndex({ [CP.KHAN]: [KH_DEFINITION] }).size).toBe(0);
  });
});

describe('buildIndex gloss preference', () => {
  const POINTER_GLOSS = '(intj) alternative form of ' + HELLO_COENG_TA;

  it('prefers a real gloss over one that just points at the other spelling', () => {
    // Both orders: preference must not depend on which the file lists first.
    const orders: Record<string, Packed>[] = [
      { [HELLO_COENG_DA]: ['', POINTER_GLOSS], [HELLO_COENG_TA]: ['', EN_GLOSS] },
      { [HELLO_COENG_TA]: ['', EN_GLOSS], [HELLO_COENG_DA]: ['', POINTER_GLOSS] },
    ];

    for (const entries of orders) {
      expect(lookupIn(buildIndex(entries), HELLO_COENG_TA)?.en).toBe(EN_GLOSS);
    }
  });

  it('still shows a pointer gloss when it is the only one there is', () => {
    const only = buildIndex({ [HELLO_COENG_DA]: ['', POINTER_GLOSS] });
    expect(lookupIn(only, HELLO_COENG_TA)?.en).toBe(POINTER_GLOSS);
  });
});

describe('modern Khmer definitions', () => {
  const MODERN = LANGUAGE_ZWSP_KHMER + CP.KHAN;

  it('carries all three fields through a lookup', () => {
    const dict = buildIndex({ [LANGUAGE]: [KH_DEFINITION, EN_GLOSS, MODERN] });
    expect(lookupIn(dict, LANGUAGE)).toEqual({
      word: LANGUAGE,
      kh: KH_DEFINITION,
      en: EN_GLOSS,
      modern: MODERN,
    });
  });

  it('merges a modern definition onto the other spelling of the same word', () => {
    // Chuon Nath catalogues under coeng ដ, Khmer Wiktionary under coeng ត.
    const dict = buildIndex({
      [HELLO_COENG_DA]: [KH_DEFINITION],
      [HELLO_COENG_TA]: ['', EN_GLOSS, MODERN],
    });

    const entry = lookupIn(dict, HELLO_COENG_DA);
    expect(entry?.kh).toBe(KH_DEFINITION);
    expect(entry?.modern).toBe(MODERN);
  });

  it('reports an absent modern definition as absent', () => {
    // Only ~1,364 words have one, so this is the common case and the panel
    // must render nothing rather than an empty labelled block.
    const dict = buildIndex({ [LANGUAGE]: [KH_DEFINITION, EN_GLOSS] });
    expect(lookupIn(dict, LANGUAGE)?.modern).toBeUndefined();
  });
});
