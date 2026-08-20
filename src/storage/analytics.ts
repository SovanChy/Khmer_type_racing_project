/**
 * The Phase 5 queries. Pure SQL and result shapes — no browser API, so
 * `analytics.test.ts` exercises them against the same SQLite build the worker
 * runs.
 *
 * Every ranking excludes rarely-seen targets: one mistake out of one attempt is
 * 0% accuracy and would otherwise top every list forever.
 */

/** A mistake this old counts half as much as one made just now. */
export const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ponytail: gaps longer than this are treated as the user looking away rather
 * than hesitating, and dropped from timing stats. A blunt instrument — a median
 * would be better than a capped mean, but SQLite has no median and the shape of
 * the answer (which keys are slow) survives the approximation.
 */
export const PAUSE_CUTOFF_MS = 2000;

export interface ClusterStat {
  cluster: string;
  attempts: number;
  correct: number;
  meanMs: number;
}

export interface CodepointStat {
  codepoint: string;
  attempts: number;
  correct: number;
  meanMs: number;
}

export interface SubscriptStat {
  codepoint: string;
  attempts: number;
  correct: number;
  /** Errors discounted by age, so old habits fade as they are fixed. */
  weightedErrors: number;
}

export interface TrendPoint {
  id: number;
  startedAt: number;
  mode: string;
  cpm: number;
  /** NULL for sessions saved before wpm was recorded — see MIGRATIONS v3. */
  wpm: number | null;
  accuracy: number;
}

/** Per-cluster accuracy, worst first. */
export const WORST_CLUSTERS = `
SELECT target_cluster                              AS cluster,
       COUNT(*)                                    AS attempts,
       SUM(correct)                                AS correct,
       AVG(ms_since_prev)                          AS meanMs
FROM keystrokes
WHERE target_cluster IS NOT NULL
GROUP BY target_cluster
HAVING COUNT(*) >= $minAttempts
-- CAST or SQLite does integer division and every accuracy collapses to 0.
ORDER BY CAST(SUM(correct) AS REAL) / COUNT(*) ASC, COUNT(*) DESC
LIMIT $limit
`;

/** Subscript (coeng) consonants mistyped most, weighted by recency. */
export const WORST_SUBSCRIPTS = `
SELECT k.target_codepoint AS codepoint,
       COUNT(*)           AS attempts,
       SUM(k.correct)     AS correct,
       SUM((1 - k.correct) * pow(0.5, ($now - s.started_at) / CAST($halfLife AS REAL)))
                          AS weightedErrors
FROM keystrokes k
JOIN sessions s ON s.id = k.session_id
WHERE k.subscript = 1 AND k.target_codepoint IS NOT NULL
GROUP BY k.target_codepoint
HAVING COUNT(*) >= $minAttempts
ORDER BY weightedErrors DESC, attempts DESC
LIMIT $limit
`;

/**
 * Mean time-to-keystroke per target codepoint — the hesitation keys, which are
 * not the same set as the error keys.
 */
export const SLOWEST_CODEPOINTS = `
SELECT target_codepoint AS codepoint,
       COUNT(*)         AS attempts,
       SUM(correct)     AS correct,
       AVG(ms_since_prev) AS meanMs
FROM keystrokes
WHERE target_codepoint IS NOT NULL
  -- 0 is the first keystroke of a run, which measures nothing.
  AND ms_since_prev > 0
  AND ms_since_prev < $pauseCutoff
GROUP BY target_codepoint
HAVING COUNT(*) >= $minAttempts
ORDER BY meanMs DESC
LIMIT $limit
`;

/** Accuracy and speed over recent sessions, returned oldest first for plotting. */
export const SESSION_TREND = `
SELECT * FROM (
  SELECT id, started_at AS startedAt, mode, cpm, wpm, accuracy
  FROM sessions
  ORDER BY started_at DESC
  LIMIT $limit
)
ORDER BY startedAt ASC
`;
