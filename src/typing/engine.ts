import { compare, type CharState } from '../khmer/compare';
import { COENG, segment, stripInvisible } from '../khmer/segment';

/**
 * A "word" is 5 clusters. Khmer has no space-delimited word the way Latin does,
 * so any WPM figure is a convention, not a measurement -- the UI must label it.
 */
export const CLUSTERS_PER_WORD = 5;

/**
 * Longest run we will render as a single word when the text gives us no
 * boundary of its own. Without this a corpus lacking ZWSP becomes one enormous
 * word and every keypress re-renders the entire passage.
 */
const DEFAULT_MAX_CLUSTERS = 12;

/**
 * Split passage text into the words the UI renders.
 *
 * ZWSP marks a boundary the user never types; a real space marks one they do.
 * So we split after either, keep the space attached to the word before it, and
 * strip the ZWSP -- which is why splitting must happen BEFORE stripping. Running
 * `stripInvisible()` over the whole passage first, as a literal reading of "strip
 * at load" would suggest, destroys every word boundary in the text.
 *
 * Invariant: `toWords(t).join('') === stripInvisible(t)`.
 */
export function toWords(text: string, maxClusters = DEFAULT_MAX_CLUSTERS): string[] {
  return text
    .split(/(?<=[\u200B ])/)
    .map(stripInvisible)
    .filter((word) => word.length > 0)
    .flatMap((word) => chunkByClusters(word, maxClusters));
}

/** Cut an over-long word at cluster boundaries, never inside a stacked glyph. */
function chunkByClusters(word: string, maxClusters: number): string[] {
  const clusters = segment(word);
  if (clusters.length <= maxClusters) return [word];

  const chunks: string[] = [];
  for (let i = 0; i < clusters.length; i += maxClusters) {
    chunks.push(clusters.slice(i, i + maxClusters).join(''));
  }
  return chunks;
}

/** Codepoint offset each word starts at, for slicing the flat typed buffer. */
export function wordStarts(words: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const word of words) {
    starts.push(offset);
    offset += [...word].length;
  }
  return starts;
}

export type CellStatus = 'correct' | 'incorrect' | 'partial' | 'pending';

export interface Cell {
  text: string;
  status: CellStatus;
}

export interface ClusterView {
  cells: Cell[];
  /** Cluster index the caret sits before; `cells.length` once the word is done. */
  caret: number;
}

/**
 * Fold per-codepoint comparison up to the cluster, which is the unit we paint.
 * A stacked glyph cannot be half-coloured, so a single wrong codepoint condemns
 * the whole cluster it belongs to.
 */
export function clusterView(target: string, typed: string): ClusterView {
  const groups: CharState[][] = [];
  for (const state of compare(target, typed)) {
    const group = groups[state.cluster] ?? (groups[state.cluster] = []);
    group.push(state);
  }

  const cells = groups.map((group) => ({
    text: group.map((s) => s.cp).join(''),
    status: cellStatus(group),
  }));

  const caret = cells.findIndex((c) => c.status === 'pending' || c.status === 'partial');
  return { cells, caret: caret === -1 ? cells.length : caret };
}

function cellStatus(group: CharState[]): CellStatus {
  if (group.some((s) => s.status === 'incorrect')) return 'incorrect';
  if (group.every((s) => s.status === 'correct')) return 'correct';
  if (group.some((s) => s.status === 'correct')) return 'partial';
  return 'pending';
}

/** Clusters typed completely and correctly — the basis for the WPM convention. */
export function countCorrectClusters(target: string, typed: string): number {
  return clusterView(target, typed).cells.filter((c) => c.status === 'correct').length;
}

/** Codepoints standing correct in the buffer — the basis for net CPM. */
export function countCorrectCodepoints(target: string, typed: string): number {
  return compare(target, typed).filter((s) => s.status === 'correct').length;
}

/**
 * Index of the word the caret sits in: the last one starting at or before it.
 * A caret exactly on a boundary belongs to the word it is about to start, which
 * is what makes a finished word hand "active" to the next one with no keystroke.
 */
export function activeWordIndex(starts: number[], caret: number): number {
  let active = -1;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    if (start !== undefined && start <= caret) active = i;
  }
  return active;
}

export interface TargetSite {
  codepoint: string;
  /** The whole cluster this codepoint belongs to. */
  cluster: string;
  /** True when this is the consonant directly after a coeng. */
  subscript: boolean;
}

/**
 * One entry per target codepoint, carrying what the analytics tables need.
 *
 * Computed once per passage. Both facts are free here and unrecoverable later:
 * a stored keystroke row cannot tell you which cluster it belonged to, and
 * per-cluster accuracy is the statistic that actually matters for Khmer.
 */
export function targetSites(target: string): TargetSite[] {
  const sites: TargetSite[] = [];

  for (const cluster of segment(target)) {
    const codepoints = [...cluster];
    codepoints.forEach((codepoint, i) => {
      sites.push({ codepoint, cluster, subscript: codepoints[i - 1] === COENG });
    });
  }

  return sites;
}

export type WordStatus = 'done' | 'active' | 'pending';

export interface WordProps {
  target: string;
  typed: string;
  status: WordStatus;
}

/**
 * Derive every `<Word>`'s props from the caret alone.
 *
 * This is where the performance invariant actually lives. A finished word's
 * slice of the buffer never changes again, and a not-yet-reached word's slice
 * stays empty, so both produce props equal to last keystroke's and `React.memo`
 * bails them out — leaving only the active word to re-render. Keeping this a
 * pure function is what lets `engine.test.ts` prove that, instead of trusting
 * a render counter someone has to remember to look at.
 */
export function wordProps(words: string[], typed: readonly string[], caret: number): WordProps[] {
  const active = activeWordIndex(wordStarts(words), caret);
  let offset = 0;

  return words.map((target, i) => {
    const start = offset;
    offset += [...target].length;
    return {
      target,
      typed: typed.slice(start, offset).join(''),
      status: i < active ? 'done' : i === active ? 'active' : 'pending',
    };
  });
}

export interface ScoreInput {
  /** Correct codepoints currently standing in the buffer. */
  correctCp: number;
  correctClusters: number;
  /** Keypresses that were right when pressed, including ones later erased. */
  correctPresses: number;
  totalPresses: number;
  ms: number;
}

export interface Score {
  cpm: number;
  wpm: number;
  accuracy: number;
}

/**
 * Wall-clock elapsed time with paused (blurred) time excluded. One definition
 * so `finalScore()`, the saved `durationMs`, and the live stats in
 * `TypingTest.tsx` can't drift apart on the same subtraction.
 */
export function elapsedMs({
  startedAt,
  endedAt,
  pausedMs,
}: {
  startedAt: number;
  endedAt: number;
  pausedMs: number;
}): number {
  return endedAt - startedAt - pausedMs;
}

export function score({
  correctCp,
  correctClusters,
  correctPresses,
  totalPresses,
  ms,
}: ScoreInput): Score {
  const minutes = ms / 60_000;
  return {
    // Net, not gross: a wrong keypress earns no speed. Errors already show up
    // in accuracy, and counting them here too would punish them twice.
    cpm: minutes > 0 ? correctCp / minutes : 0,
    wpm: minutes > 0 ? correctClusters / CLUSTERS_PER_WORD / minutes : 0,
    // Before the first keypress there is no ratio to report; 100% reads better
    // than NaN and is what every other trainer shows at rest.
    accuracy: totalPresses > 0 ? correctPresses / totalPresses : 1,
  };
}
