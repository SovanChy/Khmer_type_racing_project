import { stripInvisible } from '../khmer/segment';
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
