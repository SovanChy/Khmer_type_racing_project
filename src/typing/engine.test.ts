import { describe, expect, it } from 'vitest';
import {
  activeWordIndex,
  clusterView,
  countCorrectClusters,
  countCorrectCodepoints,
  elapsedMs,
  score,
  targetSites,
  toWords,
  wordProps,
  wordStarts,
} from './engine';
import { stripInvisible } from '../khmer/segment';
import {
  CP,
  COENG_STACK,
  KHMER,
  LANGUAGE,
  PASSAGE_SPACED,
  PASSAGE_ZWSP,
  SREY,
} from '../khmer/__fixtures__/khmer';

describe('toWords', () => {
  it('splits at ZWSP boundaries', () => {
    expect(toWords(PASSAGE_ZWSP)).toEqual([LANGUAGE, KHMER, SREY]);
  });

  it('removes the ZWSP so it never reaches the typing engine', () => {
    for (const word of toWords(PASSAGE_ZWSP)) expect(word).not.toContain(CP.ZWSP);
  });

  it('rejoins to exactly the stripped text', () => {
    // The whole codepoint-offset scheme depends on this: splitting for display
    // must not add or lose a single typeable codepoint.
    for (const text of [PASSAGE_ZWSP, PASSAGE_SPACED, LANGUAGE, '']) {
      expect(toWords(text).join('')).toBe(stripInvisible(text));
    }
  });

  it('keeps a real space attached to the word before it, because it is typed', () => {
    expect(toWords(PASSAGE_SPACED)).toEqual([`${LANGUAGE} `, KHMER]);
  });

  it('drops empty words from doubled separators', () => {
    expect(toWords(LANGUAGE + CP.ZWSP + CP.ZWSP + KHMER)).toEqual([LANGUAGE, KHMER]);
  });

  it('returns nothing for empty text', () => {
    expect(toWords('')).toEqual([]);
  });

  it('chunks a long run that carries no ZWSP at all', () => {
    // A corpus without ZWSP would otherwise be one giant word, and the whole
    // per-word render isolation would collapse to re-rendering everything.
    const long = KHMER.repeat(12); // 24 clusters, no separators
    const words = toWords(long, 5);
    expect(words.length).toBeGreaterThan(1);
    expect(words.join('')).toBe(long);
  });

  it('never splits a chunk inside a cluster', () => {
    const long = KHMER.repeat(12);
    // A chunk starting with a coeng or a vowel sign means a stack was cut open.
    for (const word of toWords(long, 5)) {
      expect(word.startsWith(CP.COENG)).toBe(false);
      expect(word.startsWith(CP.SRA_AE)).toBe(false);
    }
  });
});

describe('wordStarts', () => {
  it('gives the codepoint offset each word begins at', () => {
    // ភាសា is 4 codepoints, ខ្មែរ is 5
    expect(wordStarts([LANGUAGE, KHMER, SREY])).toEqual([0, 4, 9]);
  });

  it('counts codepoints, not UTF-16 units', () => {
    expect(wordStarts(['😀', KHMER])).toEqual([0, 1]);
  });

  it('handles no words', () => {
    expect(wordStarts([])).toEqual([]);
  });
});

describe('clusterView', () => {
  it('marks an untyped word pending with the caret at the start', () => {
    const view = clusterView(KHMER, '');
    expect(view.cells.map((c) => c.status)).toEqual(['pending', 'pending']);
    expect(view.caret).toBe(0);
  });

  it('renders one cell per cluster, not per codepoint', () => {
    // ខ ្ ម ែ រ is five codepoints but only two clusters.
    expect(clusterView(KHMER, '').cells.map((c) => c.text)).toEqual([
      CP.KHA + CP.COENG + CP.MO + CP.SRA_AE,
      CP.RO,
    ]);
  });

  it('marks a fully correct word correct with the caret past the end', () => {
    const view = clusterView(KHMER, KHMER);
    expect(view.cells.map((c) => c.status)).toEqual(['correct', 'correct']);
    expect(view.caret).toBe(2);
  });

  it('marks a whole cluster incorrect when any codepoint in it is wrong', () => {
    // A stacked glyph cannot be half-painted, so one bad codepoint condemns
    // the cluster it belongs to.
    const wrong = CP.KHA + CP.COENG + CP.KA + CP.SRA_AE + CP.RO;
    expect(clusterView(KHMER, wrong).cells.map((c) => c.status)).toEqual(['incorrect', 'correct']);
  });

  it('marks a half-typed cluster partial and parks the caret on it', () => {
    const view = clusterView(KHMER, CP.KHA + CP.COENG);
    expect(view.cells.map((c) => c.status)).toEqual(['partial', 'pending']);
    expect(view.caret).toBe(0);
  });

  it('moves the caret to the next cluster once the previous one is complete', () => {
    const view = clusterView(KHMER, CP.KHA + CP.COENG + CP.MO + CP.SRA_AE);
    expect(view.cells.map((c) => c.status)).toEqual(['correct', 'pending']);
    expect(view.caret).toBe(1);
  });

  it('handles an empty word', () => {
    expect(clusterView('', '')).toEqual({ cells: [], caret: 0 });
  });
});

describe('countCorrectClusters', () => {
  it('counts only clusters that are complete and correct', () => {
    expect(countCorrectClusters(KHMER, KHMER)).toBe(2);
  });

  it('does not count a half-typed cluster', () => {
    expect(countCorrectClusters(KHMER, CP.KHA + CP.COENG)).toBe(0);
  });

  it('does not count a cluster containing a mistake', () => {
    const wrong = CP.KHA + CP.COENG + CP.KA + CP.SRA_AE + CP.RO;
    expect(countCorrectClusters(KHMER, wrong)).toBe(1);
  });

  it('counts nothing for nothing typed', () => {
    expect(countCorrectClusters(KHMER, '')).toBe(0);
  });
});

describe('countCorrectCodepoints', () => {
  it('counts codepoints standing correct in the buffer', () => {
    expect(countCorrectCodepoints(KHMER, KHMER)).toBe(5);
  });

  it('counts correct codepoints inside an otherwise wrong cluster', () => {
    // Unlike the cluster count, this is per keystroke: 4 of 5 landed right.
    const wrong = CP.KHA + CP.COENG + CP.KA + CP.SRA_AE + CP.RO;
    expect(countCorrectCodepoints(KHMER, wrong)).toBe(4);
  });

  it('counts nothing for nothing typed', () => {
    expect(countCorrectCodepoints(KHMER, '')).toBe(0);
  });
});

describe('activeWordIndex', () => {
  const starts = [0, 4, 9]; // ភាសា | ខ្មែរ | ស្រី

  it('starts on the first word', () => {
    expect(activeWordIndex(starts, 0)).toBe(0);
  });

  it('stays on a word while it is being typed', () => {
    expect(activeWordIndex(starts, 3)).toBe(0);
  });

  it('hands over to the next word the moment the caret reaches its start', () => {
    // This is what makes ZWSP boundaries advance with no keystroke.
    expect(activeWordIndex(starts, 4)).toBe(1);
  });

  it('reaches the last word', () => {
    expect(activeWordIndex(starts, 9)).toBe(2);
  });

  it('clamps to the last word once the passage is complete', () => {
    expect(activeWordIndex(starts, 999)).toBe(2);
  });

  it('reports no active word when there are no words', () => {
    expect(activeWordIndex([], 0)).toBe(-1);
  });
});

describe('targetSites', () => {
  it('gives one entry per codepoint, not per cluster', () => {
    expect(targetSites(KHMER)).toHaveLength(5);
  });

  it('lines up with the codepoints the comparison uses', () => {
    expect(targetSites(KHMER).map((s) => s.codepoint)).toEqual([...KHMER]);
  });

  it('attributes every codepoint of a stack to the whole cluster', () => {
    // ខ ្ ម ែ all belong to ខ្មែ; រ stands alone.
    expect(targetSites(KHMER).map((s) => s.cluster)).toEqual([
      CP.KHA + CP.COENG + CP.MO + CP.SRA_AE,
      CP.KHA + CP.COENG + CP.MO + CP.SRA_AE,
      CP.KHA + CP.COENG + CP.MO + CP.SRA_AE,
      CP.KHA + CP.COENG + CP.MO + CP.SRA_AE,
      CP.RO,
    ]);
  });

  it('marks only the consonant directly after a coeng as subscript', () => {
    // ខ ្ ម ែ រ  ->  only ម is a subscript consonant
    expect(targetSites(KHMER).map((s) => s.subscript)).toEqual([false, false, true, false, false]);
  });

  it('marks the subscript in a bare coeng stack', () => {
    expect(targetSites(COENG_STACK).map((s) => s.subscript)).toEqual([false, false, true]);
  });

  it('marks nothing as subscript in text with no coeng', () => {
    expect(targetSites(LANGUAGE).some((s) => s.subscript)).toBe(false);
  });

  it('handles empty text', () => {
    expect(targetSites('')).toEqual([]);
  });
});

describe('wordProps — the performance invariant', () => {
  // A 40-word passage. If a keystroke changed props broadly, memo would let the
  // whole thing re-render, which CLAUDE.md calls a bug rather than a tradeoff.
  const words = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? KHMER : LANGUAGE));
  const target = [...words.join('')];

  /** Props after typing the passage correctly up to `caret`. */
  const at = (caret: number) => wordProps(words, target.slice(0, caret), caret);

  const differing = (a: ReturnType<typeof at>, b: ReturnType<typeof at>) =>
    a.reduce((n, prop, i) => {
      const other = b[i];
      const same =
        other !== undefined &&
        prop.target === other.target &&
        prop.typed === other.typed &&
        prop.status === other.status;
      return same ? n : n + 1;
    }, 0);

  it('changes exactly one word when a keystroke lands mid-word', () => {
    // Caret 1 -> 2 is inside ខ្មែរ (5 codepoints), so only it may move.
    expect(differing(at(1), at(2))).toBe(1);
  });

  it('changes at most two words when a keystroke crosses a word boundary', () => {
    // The finished word goes active->done and the next goes pending->active.
    // Two is inherent to a handover; anything more is the passage re-rendering.
    expect(differing(at(4), at(5))).toBeLessThanOrEqual(2);
  });

  it('never disturbs a word the caret is nowhere near', () => {
    const before = at(2);
    const after = at(3);
    for (let i = 5; i < words.length; i++) {
      expect(before[i], `word ${i}`).toEqual(after[i]);
    }
  });

  it('keeps a finished word frozen for the rest of the test', () => {
    const early = at(10)[0];
    const late = at(120)[0];
    expect(early).toEqual(late);
    expect(early?.status).toBe('done');
  });

  it('leaves untouched words with an empty typed slice', () => {
    const props = at(3);
    expect(props.slice(2).every((p) => p.typed === '')).toBe(true);
  });

  it('gives each word its own slice of the buffer', () => {
    expect(at(target.length).map((p) => p.typed)).toEqual(words);
  });

  it('marks exactly one word active while typing', () => {
    expect(at(7).filter((p) => p.status === 'active')).toHaveLength(1);
  });
});

describe('elapsedMs', () => {
  it('subtracts paused time from the wall-clock span', () => {
    // A 60s run with 10s spent blurred should score as 50s, not 60s — the
    // whole point of tracking pausedMs is that time away doesn't inflate
    // duration/cpm for the saved session.
    expect(elapsedMs({ startedAt: 0, endedAt: 60_000, pausedMs: 10_000 })).toBe(50_000);
  });

  it('feeds a paused span straight into cpm via score()', () => {
    const ms = elapsedMs({ startedAt: 0, endedAt: 60_000, pausedMs: 10_000 });
    // 500 correct codepoints in the 50s actually spent typing = 600/min, not
    // the 500/min a naive endedAt-startedAt would report.
    const { cpm } = score({
      correctCp: 500,
      correctClusters: 0,
      correctPresses: 500,
      totalPresses: 500,
      ms,
    });
    expect(cpm).toBe(600);
  });

  it('returns the full span when nothing was paused', () => {
    expect(elapsedMs({ startedAt: 1_000, endedAt: 4_000, pausedMs: 0 })).toBe(3_000);
  });
});

describe('score', () => {
  const base = { correctCp: 300, correctClusters: 100, correctPresses: 300, totalPresses: 320 };

  it('reports CPM as correct codepoints per minute', () => {
    expect(score({ ...base, ms: 60_000 }).cpm).toBe(300);
  });

  it('scales CPM to a partial minute', () => {
    expect(score({ ...base, ms: 30_000 }).cpm).toBe(600);
  });

  it('defines a word as five clusters, not five characters', () => {
    // 100 correct clusters in one minute = 20 "words".
    expect(score({ ...base, ms: 60_000 }).wpm).toBe(20);
  });

  it('reports accuracy over every keypress, including ones later corrected', () => {
    expect(score({ ...base, ms: 60_000 }).accuracy).toBeCloseTo(300 / 320);
  });

  it('reports full accuracy before anything is typed rather than NaN', () => {
    const s = score({ correctCp: 0, correctClusters: 0, correctPresses: 0, totalPresses: 0, ms: 0 });
    expect(s.accuracy).toBe(1);
  });

  it('reports zero rather than Infinity when no time has elapsed', () => {
    const s = score({ ...base, ms: 0 });
    expect(s.cpm).toBe(0);
    expect(s.wpm).toBe(0);
  });
});
