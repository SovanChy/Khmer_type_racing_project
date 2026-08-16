import { describe, expect, it } from 'vitest';
import { buildPassage, parseCorpus } from './index';
import { CP, KHMER, LANGUAGE, PASSAGE_ZWSP, SREY } from '../khmer/__fixtures__/khmer';

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
