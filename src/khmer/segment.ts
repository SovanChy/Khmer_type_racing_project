/**
 * Khmer grapheme-cluster segmentation.
 *
 * `Intl.Segmenter` is deliberately not used here. It follows UAX #29, which
 * splits coeng (subscript) sequences -- U+1780 U+17D2 U+1780 comes out as two
 * clusters instead of one -- so a caret placed by it lands inside a stacked
 * glyph.
 *
 * The ranges are written as escapes, never as glyphs. A mistyped bound inside a
 * character-class range is invisible in a diff and would silently mis-segment
 * real text.
 */

/** U+17D2 KHMER SIGN COENG. The codepoint directly after it is a subscript. */
export const COENG = '\u17D2';

const BASE = '[\u1780-\u17A2\u17A5-\u17B3]'; // consonants + independent vowels
const COENG_SEQUENCE = `(?:${COENG}${BASE})`; // COENG + subscript consonant
const SIGN = '[\u17B6-\u17D1\u17D3\u17DD]'; // dependent vowels + diacritics

/**
 * `s` (dotAll) is load-bearing, not cosmetic. Without it `.` does not match line
 * terminators, and `matchAll` skips unmatched input silently -- so a newline
 * would vanish, `segment(t).join('') !== t`, and every codepoint-to-cluster
 * index after it would be off by one. `segment.test.ts` pins this.
 */
const CLUSTER = new RegExp(`${BASE}${COENG_SEQUENCE}*${SIGN}*|.`, 'gus');

/** Split text into clusters. Lossless: the result always rejoins to the input. */
export function segment(text: string): string[] {
  return Array.from(text.matchAll(CLUSTER), (m) => m[0]);
}

/**
 * Remove U+200B ZERO WIDTH SPACE, which well-encoded Khmer uses as a word
 * separator. Users cannot see it and will never type it, so leaving it in the
 * target would stall the trainer on an untypeable character.
 *
 * Only ZWSP. U+200C/U+200D (ZWNJ/ZWJ) are *not* stripped despite the function
 * name -- they change how Khmer ligatures render, so removing them would alter
 * the text rather than just clean it.
 */
export function stripInvisible(text: string): string {
  return text.replaceAll('\u200B', '');
}
