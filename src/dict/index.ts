import { segment, stripInvisible } from '../khmer/segment';

/**
 * One dictionary entry: Chuon Nath 1967, an English gloss, and a modern Khmer
 * definition. Any of the three may be absent; at least one is always present.
 *
 * A positional array rather than an object — 22,243 of them go over the wire,
 * and `["…","…"]` costs 13 fewer bytes per entry than `{"kh":…}`.
 */
export type Packed = [kh: string, en?: string, modern?: string];

export interface Entry {
  word: string;
  /** Chuon Nath, 1967. */
  kh?: string;
  en?: string;
  /** Khmer Wiktionary — present only where it is not a copy of Chuon Nath. */
  modern?: string;
}

/** U+17D2 KHMER SIGN COENG. */
const COENG = '្';
const DA = 'ដ';
const TA = 'ត';

/**
 * Khmer punctuation that can ride along on a word taken from a passage: khan,
 * bariyoosan, camnuc pii kuuh, and the ASCII marks a pasted quote can carry.
 */
const PUNCTUATION = /[។៕៖៙៚!?,.;:()"'«»​\s]/g;

/**
 * Normalise a word to its dictionary key.
 *
 * Folds subscript ដ to subscript ត. Chuon Nath spells 333 headwords with one
 * and 643 with the other, and modern typing overwhelmingly produces ត — so
 * `សួស្តី` as typed would miss `សួស្ដី` as catalogued. The two are visually
 * near-identical and never contrast meaning in these entries, so folding costs
 * no precision. This is a lookup key only: it never touches what is compared,
 * scored or displayed.
 */
export function foldWord(word: string): string {
  return stripInvisible(word).replace(PUNCTUATION, '').replace(
    new RegExp(COENG + DA, 'g'),
    COENG + TA,
  );
}

/**
 * Find a word in an already-loaded index.
 *
 * Split out from `lookup` so the fallback chain is testable without a network
 * or a 4.9MB fixture.
 */
export function lookupIn(index: Map<string, Packed>, word: string): Entry | null {
  const key = foldWord(word);
  if (key === '') return null;

  const packed = index.get(key);
  if (!packed) return null;

  const [kh, en, modern] = packed;
  return {
    word,
    kh: kh || undefined,
    en: en || undefined,
    modern: modern || undefined,
  };
}

/** Khmer and Latin digits. A numeral is a token of its own, never a headword. */
const NUMERAL = /^[0-9០-៩៰-៹]+$/;

/**
 * Find a tapped word, splitting it when the segmenter handed us more than one.
 *
 * `Intl.Segmenter` keeps together things the dictionary catalogues apart. ខែសីហា
 * "August" is one segment and two headwords (ខែ "month" + សីហា). Worse, UAX #29
 * refuses to break between a letter and a digit at all, so ឆ្នាំ២០២៦នេះ arrives
 * as a single word. None of those are headwords, and reporting "no entry" for
 * them is wrong when every piece has a definition.
 *
 * Greedy longest match, left to right, over clusters — never codepoints, or a
 * match could end inside a stacked glyph. All-or-nothing: a word with a piece
 * that resolves to nothing returns nothing, rather than a confident half
 * answer. That is what stops a proper noun from being explained as two
 * unrelated syllables that happen to be in the dictionary.
 */
export function lookupWord(index: Map<string, Packed>, word: string): Entry[] {
  const exact = lookupIn(index, word);
  if (exact) return [exact];

  const clusters = segment(foldWord(word));
  const parts: Entry[] = [];

  for (let i = 0; i < clusters.length; ) {
    // Numerals first: a digit run is never a headword, and checking the
    // dictionary first would decompose ២០២៦ into single digits if any one of
    // them happens to be catalogued.
    const digits = numeralRun(clusters, i);
    if (digits > i) {
      i = digits;
      continue;
    }

    let end = clusters.length;
    for (; end > i; end--) if (index.has(clusters.slice(i, end).join(''))) break;
    if (end === i) return [];

    const entry = lookupIn(index, clusters.slice(i, end).join(''));
    if (entry) parts.push(entry);
    i = end;
  }

  return parts;
}

/** Index just past the run of numerals starting at `from`, or `from` if none. */
function numeralRun(clusters: string[], from: number): number {
  let i = from;
  while (i < clusters.length && NUMERAL.test(clusters[i] ?? '')) i++;
  return i;
}

/**
 * Key the raw file by folded word, merging entries that collide.
 *
 * Folding makes collisions certain rather than rare: `សួស្ដី` (Chuon Nath's
 * spelling, with the Khmer definition) and `សួស្តី` (Wiktionary's, with the
 * English gloss) are two entries in the file and one key here. Overwriting
 * would silently drop whichever arrived first — which is exactly what it did,
 * costing the Khmer definition on a word that has one.
 *
 * The merge is order-independent: no entry can erase a filled field, and a
 * real gloss always beats a pointer one (see `better`).
 */
export function buildIndex(raw: Record<string, Packed>): Map<string, Packed> {
  const index = new Map<string, Packed>();

  for (const [word, [kh, en, modern]] of Object.entries(raw)) {
    const key = foldWord(word);
    if (key === '') continue;

    const seen = index.get(key);
    if (seen) {
      index.set(key, [
        better(seen[0], kh),
        better(seen[1] ?? '', en ?? ''),
        better(seen[2] ?? '', modern ?? ''),
      ]);
    } else index.set(key, [kh, en, modern]);
  }

  return index;
}

/**
 * Wiktionary defines one spelling and points the other at it. Since folding
 * merges exactly those pairs, the pointer and the definition it points at
 * always land on the same key — and "alternative form of សួស្តី" is a useless
 * thing to show someone who just tapped សួស្តី.
 */
const POINTER = /\b(?:alternative|obsolete|archaic|nonstandard) (?:form|spelling) of\b/i;

/** The more useful of two candidate values for one field. */
function better(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  // Khmer definitions never match POINTER, so for those this is just "keep
  // the first", which is what order-independence requires.
  return POINTER.test(a) && !POINTER.test(b) ? b : a;
}

/** Built from `dict.json` on first use, then reused. */
let index: Promise<Map<string, Packed>> | undefined;

/**
 * Fetched on the first lookup, never at startup.
 *
 * 790KB brotli is not something to spend before a user has asked a question,
 * and a typing trainer is fully usable without ever tapping a word. Once
 * fetched the service worker holds it, so later lookups work offline.
 */
export function loadDict(fetchJson = defaultFetch): Promise<Map<string, Packed>> {
  index ??= fetchJson().then(buildIndex);
  return index;
}

function defaultFetch(): Promise<Record<string, Packed>> {
  // BASE_URL, not a bare '/', so this still resolves if the site is ever
  // served from a subdirectory.
  return fetch(`${import.meta.env.BASE_URL}dict.json`).then((res) => {
    if (!res.ok) throw new Error(`dictionary unavailable (HTTP ${res.status})`);
    return res.json() as Promise<Record<string, Packed>>;
  });
}

/** Empty when the word has no definition, one entry usually, more when it splits. */
export async function lookup(word: string): Promise<Entry[]> {
  return lookupWord(await loadDict(), word);
}
