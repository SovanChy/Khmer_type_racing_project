import { stripInvisible } from '../khmer/segment';

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

export async function lookup(word: string): Promise<Entry | null> {
  return lookupIn(await loadDict(), word);
}
