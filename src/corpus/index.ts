import { NIDA_LAYOUT } from '../keyboard/layout';
import { segment, stripInvisible } from '../khmer/segment';
import { toWords } from '../typing/engine';

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export interface CorpusEntry {
  id: string;
  /** ZWSP already removed — nothing downstream ever sees an untypeable codepoint. */
  text: string;
  source: string;
  level: Level;
  /** Display words, split at the boundaries `text` no longer carries. */
  words: string[];
}

const isFilledString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);

/**
 * Validate a corpus payload into entries.
 *
 * The corpus is a file a human hand-edits, so it is untrusted input: one missing
 * field would otherwise render the string "undefined" as something to type.
 * Bad entries are skipped rather than thrown on, so one typo cannot take the
 * whole app down.
 */
export function parseCorpus(payload: unknown): CorpusEntry[] {
  const entries = (payload as { entries?: unknown } | null | undefined)?.entries;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((raw: unknown): CorpusEntry[] => {
    const e = raw as Record<string, unknown>;
    if (!isFilledString(e.id) || !isFilledString(e.text)) return [];
    if (!isFilledString(e.source) || !isLevel(e.level)) return [];

    // Split BEFORE stripping: the ZWSP is the word boundary. See toWords().
    const words = toWords(e.text);
    if (words.length === 0) return [];

    return [{ id: e.id, text: stripInvisible(e.text), source: e.source, level: e.level, words }];
  });
}

export async function loadCorpus(
  url = `${import.meta.env.BASE_URL}corpus/placeholder.json`,
): Promise<CorpusEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load corpus ${url}: HTTP ${response.status}`);
  return parseCorpus(await response.json());
}

/**
 * How strongly a corpus entry exercises the clusters the user is worst at.
 *
 * Counts exact cluster matches rather than substrings: searching for "ក" inside
 * "ក្ក" would find it twice, when the text contains no bare ក at all.
 */
export function drillScore(entry: CorpusEntry, weights: ReadonlyMap<string, number>): number {
  let score = 0;
  for (const cluster of segment(entry.text)) score += weights.get(cluster) ?? 0;
  return score;
}

/**
 * A passage biased toward the user's weak clusters.
 *
 * Every character still comes from the supplied corpus — nothing is synthesised.
 * An entry with no weak clusters keeps a baseline weight of 1, so the drill
 * stays real text rather than collapsing onto the same two sentences, and it
 * degrades to an ordinary passage when there is no history yet.
 */
export function buildDrillPassage(
  entries: CorpusEntry[],
  weights: ReadonlyMap<string, number>,
  wordCount: number,
  random: () => number = Math.random,
): string[] {
  if (entries.length === 0 || wordCount <= 0) return [];

  const weighted = entries.map((entry) => ({ entry, weight: 1 + drillScore(entry, weights) }));
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);

  const words: string[] = [];
  while (words.length < wordCount) {
    let ticket = random() * total;
    const picked = weighted.find(({ weight }) => (ticket -= weight) < 0) ?? weighted[0];
    if (picked === undefined || picked.entry.words.length === 0) break;
    words.push(...picked.entry.words);
  }
  return words.slice(0, wordCount);
}

/** Draw entries at random until we have `wordCount` words, then trim to length. */
export function buildPassage(
  entries: CorpusEntry[],
  wordCount: number,
  random: () => number = Math.random,
): string[] {
  if (entries.length === 0 || wordCount <= 0) return [];

  const words: string[] = [];
  while (words.length < wordCount) {
    const entry = entries[Math.floor(random() * entries.length) % entries.length];
    // Cannot happen for a parsed corpus, but an empty entry here would spin forever.
    if (entry === undefined || entry.words.length === 0) break;
    words.push(...entry.words);
  }
  return words.slice(0, wordCount);
}

/**
 * Word ceiling for a pasted quote. One `<Word>` mounts per word, so pasting a
 * whole article would put thousands of components on screen for a passage
 * nobody types to the end of. Well above the 150 a timed run uses.
 */
export const MAX_QUOTE_WORDS = 500;

/**
 * Every codepoint a NiDA key can produce, plus the two word separators.
 *
 * Derived from the table rather than hand-listed, so it can never drift from
 * `nida.json` — and so it correctly rejects things that merely *look*
 * typeable, such as Latin digits, whose keys carry ១២៣ instead.
 * A ligature key (`ាំ`) contributes each of its codepoints separately, which is
 * right: both halves are reachable on their own keys elsewhere.
 */
const TYPEABLE: ReadonlySet<string> = new Set([
  ' ',
  // Not typed, but `toWords` needs it intact to find the boundary before it
  // strips it — so it must survive the filter rather than count as removed.
  '\u200B',
  ...Object.values(NIDA_LAYOUT).flatMap((mapping) =>
    Object.values(mapping).flatMap((cp) => (cp ? [...cp] : [])),
  ),
]);

export interface ParsedQuote {
  words: string[];
  /** Codepoints dropped because no NiDA key produces them. */
  removed: number;
  /** True when the paste was longer than `MAX_QUOTE_WORDS`. */
  truncated: boolean;
}

/**
 * Turn arbitrary pasted text into a passage the user can actually type.
 *
 * Same role as `parseCorpus`, different source: prose off a news site carries
 * hard wraps, non-breaking spaces, curly quotes, em dashes and Latin digits,
 * none of which a NiDA keyboard can produce. Leaving them in would strand the
 * caret on a character with no key, so they are removed and counted — the
 * caller reports the count rather than silently altering what was pasted.
 */
export function parseQuote(raw: string, maxWords = MAX_QUOTE_WORDS): ParsedQuote {
  let kept = '';
  let removed = 0;
  for (const character of raw) {
    if (TYPEABLE.has(character) || /\s/.test(character)) kept += character;
    else removed++;
  }

  // Collapse AFTER stripping, not before: "ភាសា 2024 ខ្មែរ" loses the digits
  // and would otherwise be left with two adjacent spaces, which `toWords`
  // turns into a word consisting of nothing but a space — one the user has to
  // press the space bar twice to get past.
  const words = toWords(kept.replace(/\s+/g, ' ').trim());
  return { words: words.slice(0, maxWords), removed, truncated: words.length > maxWords };
}
