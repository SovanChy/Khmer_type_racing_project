import { segment } from './segment';

export type CharStatus =
  | 'correct' // typed, matches the target codepoint
  | 'incorrect' // typed, does not match
  | 'pending' // not typed yet
  | 'extra'; // typed past the end of the target

export interface CharState {
  /** The codepoint to render — the target's, or the typed one for `extra`. */
  cp: string;
  status: CharStatus;
  /** Index into `segment(target)`. Extras attach to the final cluster. */
  cluster: number;
}

/**
 * Score typed input against a target, one entry per codepoint.
 *
 * Comparison is positional and by codepoint: one NiDA keypress emits exactly
 * one codepoint, so this is what per-keystroke correctness must be judged
 * against. It deliberately does not realign after an insertion or deletion — a
 * cluster typed with its codepoints in the wrong order is wrong, even though it
 * may render identically.
 *
 * The `cluster` field carries the other half of the split: the renderer draws
 * and places the caret at cluster boundaries, because a caret inside a stacked
 * glyph breaks the display.
 */
export function compare(target: string, typed: string): CharState[] {
  const clusters = segment(target);

  // codepoint index -> cluster index. Exact because segment() is lossless.
  const clusterOf: number[] = [];
  clusters.forEach((cluster, i) => {
    for (let n = [...cluster].length; n > 0; n--) clusterOf.push(i);
  });

  const targetCps = [...target];
  const typedCps = [...typed];
  const lastCluster = Math.max(0, clusters.length - 1);

  return Array.from({ length: Math.max(targetCps.length, typedCps.length) }, (_, i) => {
    const want = targetCps[i];
    const got = typedCps[i];

    if (want === undefined) {
      // Past the target but inside the loop bound, so `got` is defined.
      return { cp: got as string, status: 'extra', cluster: lastCluster };
    }

    const cluster = clusterOf[i] ?? lastCluster;
    if (got === undefined) return { cp: want, status: 'pending', cluster };
    return { cp: want, status: got === want ? 'correct' : 'incorrect', cluster };
  });
}
