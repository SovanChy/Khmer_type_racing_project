/**
 * Khmer test data. Every Khmer literal used by the test suite lives here.
 *
 * Each entry carries its `U+XXXX` codepoint and Unicode name in a comment, and
 * `segment.test.ts` asserts the glyph actually matches that codepoint. Stacked
 * Khmer renders unreliably in editors, diffs and terminals, so a glyph that
 * *looks* right proves nothing — the assertion is what makes this data
 * trustworthy after a bad paste or an editor re-encoding.
 */

/** Single codepoints. `CODEPOINTS` below pins each one to its documented value. */
export const CP = {
  KA: 'ក', // U+1780 KHMER LETTER KA
  KHA: 'ខ', // U+1781 KHMER LETTER KHA
  NO: 'ន', // U+1793 KHMER LETTER NO
  PHO: 'ភ', // U+1797 KHMER LETTER PHO
  MO: 'ម', // U+1798 KHMER LETTER MO
  RO: 'រ', // U+179A KHMER LETTER RO
  SA: 'ស', // U+179F KHMER LETTER SA
  SRA_AA: 'ា', // U+17B6 KHMER VOWEL SIGN AA
  SRA_II: 'ី', // U+17B8 KHMER VOWEL SIGN II
  SRA_AE: 'ែ', // U+17C2 KHMER VOWEL SIGN AE
  NIKAHIT: 'ំ', // U+17C6 KHMER SIGN NIKAHIT
  COENG: '្', // U+17D2 KHMER SIGN COENG — never stands alone in valid text
  DIGIT_ONE: '១', // U+17E1 KHMER DIGIT ONE
  ZWSP: '​', // U+200B ZERO WIDTH SPACE — word separator in well-encoded Khmer
} as const;

/** The value each `CP` entry must hold. Enforced by test, not by convention. */
export const CODEPOINTS: Record<keyof typeof CP, number> = {
  KA: 0x1780,
  KHA: 0x1781,
  NO: 0x1793,
  PHO: 0x1797,
  MO: 0x1798,
  RO: 0x179a,
  SA: 0x179f,
  SRA_AA: 0x17b6,
  SRA_II: 0x17b8,
  SRA_AE: 0x17c2,
  NIKAHIT: 0x17c6,
  COENG: 0x17d2,
  DIGIT_ONE: 0x17e1,
  ZWSP: 0x200b,
};

/** ក្ក — a bare coeng stack. The spec's canonical `Intl.Segmenter` failure case. */
export const COENG_STACK = CP.KA + CP.COENG + CP.KA;

/** ស្រី "girl" — base + coeng + dependent vowel, all one cluster. */
export const SREY = CP.SA + CP.COENG + CP.RO + CP.SRA_II;

/** ខ្មែរ "Khmer" — two clusters: [ខ + ្ម + ែ] then [រ]. */
export const KHMER = CP.KHA + CP.COENG + CP.MO + CP.SRA_AE + CP.RO;

/** ភាសា "language" — two plain base+vowel clusters, no coeng. */
export const LANGUAGE = CP.PHO + CP.SRA_AA + CP.SA + CP.SRA_AA;

/** ភាសា​ខ្មែរ "Khmer language", with the ZWSP word separator real corpora carry. */
export const LANGUAGE_ZWSP_KHMER = LANGUAGE + CP.ZWSP + KHMER;

/** Three ZWSP-separated words — the shape corpus text actually arrives in. */
export const PASSAGE_ZWSP = LANGUAGE + CP.ZWSP + KHMER + CP.ZWSP + SREY;

/** A real space between words. Unlike ZWSP, the user has to type this one. */
export const PASSAGE_SPACED = LANGUAGE + ' ' + KHMER;

/**
 * ស្រី typed with the vowel before the coeng sequence: ស ី ្ រ.
 * Renders near-identically for some fonts but is a different codepoint
 * sequence, so every position after the first must read as wrong.
 */
export const SREY_WRONG_ORDER = CP.SA + CP.SRA_II + CP.COENG + CP.RO;

/** ក1a ១ ន — Khmer letters, Latin letter, Latin digit, Khmer digit, space. */
export const MIXED_SCRIPTS = `${CP.KA}1a ${CP.DIGIT_ONE} ${CP.NO}`;

/** Expected `segment()` output, one entry per case the spec calls out. */
export const CLUSTER_CASES: ReadonlyArray<{
  name: string;
  text: string;
  clusters: string[];
}> = [
  { name: 'empty string', text: '', clusters: [] },
  { name: 'single consonant', text: CP.KA, clusters: [CP.KA] },
  {
    name: 'plain consonants stay separate',
    text: CP.KA + CP.KHA + CP.NO,
    clusters: [CP.KA, CP.KHA, CP.NO],
  },
  { name: 'coeng stack is one cluster', text: COENG_STACK, clusters: [COENG_STACK] },
  { name: 'base + coeng + vowel is one cluster', text: SREY, clusters: [SREY] },
  {
    name: 'coeng cluster then bare consonant',
    text: KHMER,
    clusters: [CP.KHA + CP.COENG + CP.MO + CP.SRA_AE, CP.RO],
  },
  {
    name: 'base + vowel pairs',
    text: LANGUAGE,
    clusters: [CP.PHO + CP.SRA_AA, CP.SA + CP.SRA_AA],
  },
  {
    name: 'trailing sign attaches to its base',
    text: CP.KA + CP.SRA_AA + CP.NIKAHIT,
    clusters: [CP.KA + CP.SRA_AA + CP.NIKAHIT],
  },
  {
    name: 'ZWSP is its own cluster when not stripped',
    text: CP.KA + CP.ZWSP + CP.KHA,
    clusters: [CP.KA, CP.ZWSP, CP.KHA],
  },
  {
    name: 'mixed Khmer, Latin and digits',
    text: MIXED_SCRIPTS,
    clusters: [CP.KA, '1', 'a', ' ', CP.DIGIT_ONE, ' ', CP.NO],
  },
  {
    name: 'newlines survive segmentation',
    text: CP.KA + '\n' + CP.KHA,
    clusters: [CP.KA, '\n', CP.KHA],
  },
  {
    name: 'orphan vowel sign with no base',
    text: CP.SRA_AA + CP.KA,
    clusters: [CP.SRA_AA, CP.KA],
  },
  {
    name: 'dangling coeng with no consonant after it',
    text: CP.KA + CP.COENG,
    clusters: [CP.KA, CP.COENG],
  },
];
