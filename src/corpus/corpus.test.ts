import { describe, expect, it } from 'vitest';
import {
  buildDrillPassage,
  buildPassage,
  drillScore,
  MAX_QUOTE_WORDS,
  parseCorpus,
  parseQuote,
} from './index';
import { NIDA_LAYOUT } from '../keyboard/layout';
import {
  COENG_STACK,
  CP,
  KHMER,
  LANGUAGE,
  MIXED_SCRIPTS,
  PASSAGE_SPACED,
  PASSAGE_ZWSP,
  SREY,
} from '../khmer/__fixtures__/khmer';

const raw = (over: Record<string, unknown> = {}) => ({
  entries: [{ id: 'p01', text: PASSAGE_ZWSP, source: 'test', level: 'beginner' }],
  ...over,
});

describe('parseCorpus', () => {
  it('splits each entry into words at its ZWSP boundaries', () => {
    expect(parseCorpus(raw())[0]?.words).toEqual([LANGUAGE, KHMER, SREY]);
  });

  it('leaves no ZWSP anywhere in the loaded text', () => {
    const [entry] = parseCorpus(raw());
    expect(entry?.text).not.toContain(CP.ZWSP);
    expect(entry?.words.join('')).not.toContain(CP.ZWSP);
  });

  it('drops entries missing a required field rather than rendering undefined', () => {
    const parsed = parseCorpus(
      raw({
        entries: [
          { id: 'ok', text: PASSAGE_ZWSP, source: 'test', level: 'beginner' },
          { id: 'no-text', source: 'test', level: 'beginner' },
          { text: PASSAGE_ZWSP, source: 'test', level: 'beginner' },
        ],
      }),
    );
    expect(parsed.map((e) => e.id)).toEqual(['ok']);
  });

  it('drops an entry whose text is empty once stripped', () => {
    expect(parseCorpus(raw({ entries: [{ id: 'e', text: CP.ZWSP, source: 't', level: 'beginner' }] })))
      .toEqual([]);
  });

  it('rejects an unknown level rather than trusting the file', () => {
    expect(parseCorpus(raw({ entries: [{ id: 'e', text: KHMER, source: 't', level: 'wat' }] })))
      .toEqual([]);
  });

  it('returns nothing for a payload that is not corpus-shaped', () => {
    expect(parseCorpus(null)).toEqual([]);
    expect(parseCorpus({})).toEqual([]);
    expect(parseCorpus({ entries: 'nope' })).toEqual([]);
  });
});

describe('drillScore', () => {
  const [entry] = parseCorpus(raw()); // ភាសា ខ្មែរ ស្រី

  it('scores a cluster the entry actually contains', () => {
    expect(drillScore(entry!, new Map([[SREY, 3]]))).toBe(3);
  });

  it('scores zero when the entry contains none of the weak clusters', () => {
    expect(drillScore(entry!, new Map([[COENG_STACK, 5]]))).toBe(0);
  });

  it('sums the weights of every weak cluster present', () => {
    expect(
      drillScore(
        entry!,
        new Map([
          [SREY, 2],
          [CP.RO, 3],
        ]),
      ),
    ).toBe(5);
  });

  it('does not match a cluster that only appears inside a larger stack', () => {
    // ក appears twice inside ក្ក as a substring, but the text has no bare ក.
    const [stacked] = parseCorpus(
      raw({ entries: [{ id: 's', text: COENG_STACK, source: 't', level: 'beginner' }] }),
    );
    expect(drillScore(stacked!, new Map([[CP.KA, 1]]))).toBe(0);
  });
});

describe('buildDrillPassage', () => {
  const entries = parseCorpus(
    raw({
      entries: [
        { id: 'weak', text: PASSAGE_ZWSP, source: 't', level: 'beginner' }, // has ស្រី
        { id: 'other', text: LANGUAGE, source: 't', level: 'beginner' }, // has none
      ],
    }),
  );

  it('returns exactly the number of words asked for', () => {
    expect(buildDrillPassage(entries, new Map([[SREY, 9]]), 4, () => 0)).toHaveLength(4);
  });

  it('draws the entry containing a weak cluster when the weighting says so', () => {
    // Weight 10 vs baseline 1, and a ticket past the baseline entry's share.
    expect(buildDrillPassage(entries, new Map([[SREY, 9]]), 3, () => 0.5)).toEqual([
      LANGUAGE,
      KHMER,
      SREY,
    ]);
  });

  it('still produces a passage when there is no history to weight by', () => {
    expect(buildDrillPassage(entries, new Map(), 2, () => 0)).toHaveLength(2);
  });

  it('returns nothing for an empty corpus or a zero-word request', () => {
    expect(buildDrillPassage([], new Map([[SREY, 1]]), 5, () => 0)).toEqual([]);
    expect(buildDrillPassage(entries, new Map(), 0, () => 0)).toEqual([]);
  });
});

describe('buildPassage', () => {
  const entries = parseCorpus(raw()); // one entry, three words
  const firstAlways = () => 0;

  it('returns exactly the number of words asked for', () => {
    expect(buildPassage(entries, 7, firstAlways)).toHaveLength(7);
  });

  it('repeats the corpus when it is shorter than the requested length', () => {
    expect(buildPassage(entries, 5, firstAlways)).toEqual([LANGUAGE, KHMER, SREY, LANGUAGE, KHMER]);
  });

  it('returns nothing when the corpus is empty', () => {
    expect(buildPassage([], 10, firstAlways)).toEqual([]);
  });

  it('returns nothing for a zero-word request', () => {
    expect(buildPassage(entries, 0, firstAlways)).toEqual([]);
  });
});

describe('parseQuote', () => {
  it('keeps a real space as a word boundary the user still has to type', () => {
    // Unlike ZWSP, a space in pasted prose is a character with a key.
    expect(parseQuote(PASSAGE_SPACED).words).toEqual([LANGUAGE + ' ', KHMER]);
  });

  it('collapses a line break into a single space', () => {
    // Newspaper text pastes full of hard wraps; a newline has no key.
    const parsed = parseQuote(`${LANGUAGE}\n${KHMER}`);
    expect(parsed.words).toEqual([LANGUAGE + ' ', KHMER]);
    expect(parsed.removed).toBe(0);
  });

  it('collapses a run of whitespace into one space, not several', () => {
    expect(parseQuote(`${LANGUAGE}  \n\t ${KHMER}`).words).toEqual([LANGUAGE + ' ', KHMER]);
  });

  it('strips characters NiDA cannot type and counts them', () => {
    // MIXED_SCRIPTS is ក1a ១ ន — the Latin "1" and "a" have no NiDA key.
    const parsed = parseQuote(MIXED_SCRIPTS);
    expect(parsed.removed).toBe(2);
    expect(parsed.words.join('')).not.toMatch(/[A-Za-z0-9]/);
  });

  it('keeps Khmer punctuation, which NiDA does have a key for', () => {
    const parsed = parseQuote(LANGUAGE + CP.KHAN);
    expect(parsed.removed).toBe(0);
    expect(parsed.words.join('')).toContain(CP.KHAN);
  });

  it('splits at a ZWSP without asking the user to type it', () => {
    const parsed = parseQuote(PASSAGE_ZWSP);
    expect(parsed.words).toEqual([LANGUAGE, KHMER, SREY]);
    expect(parsed.words.join('')).not.toContain(CP.ZWSP);
    // A ZWSP is a boundary marker, not a character the user failed to type.
    expect(parsed.removed).toBe(0);
  });

  it('caps a very long paste and reports that it did', () => {
    const parsed = parseQuote(`${LANGUAGE} `.repeat(MAX_QUOTE_WORDS + 50));
    expect(parsed.words).toHaveLength(MAX_QUOTE_WORDS);
    expect(parsed.truncated).toBe(true);
  });

  it('does not claim truncation for a quote that fits', () => {
    expect(parseQuote(PASSAGE_SPACED).truncated).toBe(false);
  });

  it('leaves no word that is only a space when a stripped run sat between two', () => {
    // "…2024…" surrounded by spaces: dropping the digits must not leave a word
    // consisting of one space, which the user would have to press twice.
    expect(parseQuote(`${LANGUAGE} 2024 ${KHMER}`).words).toEqual([LANGUAGE + ' ', KHMER]);
  });

  it('returns nothing for whitespace-only input', () => {
    expect(parseQuote('   \n\t  ').words).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parseQuote('').words).toEqual([]);
  });

  it('never yields a codepoint the NiDA table cannot produce', () => {
    // The guarantee the whole function exists for: whatever survives, every
    // codepoint of it has a key. Checked against the table itself rather than
    // a hand-listed alphabet, so it cannot drift from nida.json.
    const typeable = new Set([' ']);
    for (const mapping of Object.values(NIDA_LAYOUT)) {
      for (const cp of Object.values(mapping)) for (const c of cp) typeable.add(c);
    }
    const parsed = parseQuote(`${MIXED_SCRIPTS}«»${CP.KHAN}—“${LANGUAGE}`);
    for (const c of parsed.words.join('')) {
      expect(typeable.has(c), `${c} survived but has no NiDA key`).toBe(true);
    }
  });
});
