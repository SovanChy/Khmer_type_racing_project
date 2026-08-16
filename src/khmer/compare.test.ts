import { describe, expect, it } from 'vitest';
import { compare, type CharState } from './compare';
import {
  COENG_STACK,
  CP,
  KHMER,
  MIXED_SCRIPTS,
  SREY,
  SREY_WRONG_ORDER,
} from './__fixtures__/khmer';

/** Compact status rendering so expectations read as a picture of the row. */
const SYMBOL = { correct: 'c', incorrect: 'x', pending: '.', extra: '+' } as const;
const states = (row: CharState[]) => row.map((s) => SYMBOL[s.status]).join('');
const clusters = (row: CharState[]) => row.map((s) => s.cluster);
const rendered = (row: CharState[]) => row.map((s) => s.cp).join('');

describe('compare', () => {
  it('returns nothing for empty target and empty input', () => {
    expect(compare('', '')).toEqual([]);
  });

  it('marks every codepoint pending before anything is typed', () => {
    expect(states(compare(SREY, ''))).toBe('....');
  });

  it('shows the target text while it is still pending', () => {
    expect(rendered(compare(SREY, ''))).toBe(SREY);
  });

  it('marks a fully correct entry correct', () => {
    expect(states(compare(SREY, SREY))).toBe('cccc');
  });

  it('marks a single typed codepoint correct and leaves the rest pending', () => {
    expect(states(compare(SREY, CP.SA))).toBe('c...');
  });

  it('scores a single-codepoint target', () => {
    expect(states(compare(CP.KA, CP.KA))).toBe('c');
    expect(states(compare(CP.KA, CP.KHA))).toBe('x');
  });

  it('marks the wrong codepoint incorrect without disturbing its neighbours', () => {
    // ក ្ ក with the subscript consonant mistyped as ខ
    expect(states(compare(COENG_STACK, CP.KA + CP.COENG + CP.KHA))).toBe('ccx');
  });

  it('scores a cluster typed in the wrong codepoint order as wrong', () => {
    // ស ី ្ រ vs target ស ្ រ ី — same glyphs, different sequence. Only the
    // shared first codepoint is right; a cluster-level comparison would wrongly
    // call this correct.
    expect(states(compare(SREY, SREY_WRONG_ORDER))).toBe('cxxx');
  });

  it('keeps showing the target codepoint where the typed one was wrong', () => {
    expect(rendered(compare(SREY, SREY_WRONG_ORDER))).toBe(SREY);
  });

  it('maps every codepoint of a coeng stack to one cluster', () => {
    expect(clusters(compare(COENG_STACK, ''))).toEqual([0, 0, 0]);
  });

  it('maps codepoints to their cluster across a cluster boundary', () => {
    // ខ ្ ម ែ | រ  ->  four codepoints in cluster 0, one in cluster 1
    expect(clusters(compare(KHMER, ''))).toEqual([0, 0, 0, 0, 1]);
  });

  it('maps mixed Khmer, Latin and digits to one cluster each', () => {
    expect(clusters(compare(MIXED_SCRIPTS, ''))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('marks codepoints typed past the end of the target as extra', () => {
    expect(states(compare(COENG_STACK, COENG_STACK + CP.KHA + CP.KHA))).toBe('ccc++');
  });

  it('shows what was actually typed for extra codepoints', () => {
    expect(rendered(compare(COENG_STACK, COENG_STACK + CP.KHA))).toBe(COENG_STACK + CP.KHA);
  });

  it('attaches extra codepoints to the last cluster so they render in place', () => {
    expect(clusters(compare(KHMER, KHMER + CP.KHA))).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it('reports extras against an empty target', () => {
    expect(states(compare('', CP.KA))).toBe('+');
  });

  it('counts by codepoint, not by UTF-16 unit', () => {
    // An astral char is one codepoint and must not read as two positions.
    expect(states(compare('😀', '😀'))).toBe('c');
  });
});
