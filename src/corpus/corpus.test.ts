import { describe, expect, it } from 'vitest';
import { buildDrillPassage, buildPassage, drillScore, parseCorpus } from './index';
import { COENG_STACK, CP, KHMER, LANGUAGE, PASSAGE_ZWSP, SREY } from '../khmer/__fixtures__/khmer';

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
