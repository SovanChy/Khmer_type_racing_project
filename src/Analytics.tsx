import { useEffect, useState } from 'react';
import {
  onDbStatus,
  sessionTrend,
  slowestCodepoints,
  worstClusters,
  worstSubscripts,
  type ClusterStat,
  type CodepointStat,
  type SubscriptStat,
  type TrendPoint,
} from './storage';
import { useStore } from './store';
import { CLUSTERS_PER_WORD } from './typing/engine';
import { COENG } from './khmer/segment';

/**
 * One hue for every chart, and it is not red.
 *
 * Green-vs-red failed the palette validator hard under deuteranopia (ΔE 5.0 on
 * light, 1.1 on dark), and a red "worst" bar would be a status colour doing a
 * magnitude job. Every chart here is a single series, so identity never rests on
 * hue at all — bar length plus a direct label carries the value.
 */
const SERIES = 'var(--caret)';

/**
 * Said on the chart, not only in the result panel: a Khmer 'word' here is a
 * local convention, and a number labelled WPM invites comparison with Latin
 * typing scores it is not comparable to.
 */
const WORDS_CAPTION = `${CLUSTERS_PER_WORD} Khmer clusters = 1 word`;

/** U+17D2 has no standalone glyph, so a subscript is shown attached to a base. */
const DOTTED_CIRCLE = '◌';

interface Data {
  trend: TrendPoint[];
  clusters: ClusterStat[];
  subscripts: SubscriptStat[];
  slowest: CodepointStat[];
}

export function Analytics() {
  const sessionsSaved = useStore((s) => s.sessionsSaved);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();

  useEffect(() => onDbStatus((status) => setReady(status === 'ready')), []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    Promise.all([sessionTrend(30), worstClusters(8), worstSubscripts(6), slowestCodepoints(6)])
      .then(([trend, clusters, subscripts, slowest]) => {
        if (!cancelled) setData({ trend, clusters, subscripts, slowest });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [ready, sessionsSaved]);

  // The heading renders in every state, including "still connecting". This is
  // its own page now, and returning null for the whole section left that page
  // as a blank sheet with a footer until the worker answered.
  const empty = !data || data.trend.length === 0;

  // Narrowed here rather than inline so the chart's points and its labels are
  // guaranteed to come from the same rows.
  const withWpm = (data?.trend ?? []).filter(
    (t): t is TrendPoint & { wpm: number } => t.wpm !== null,
  );

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-medium">Your progress</h2>

      {error ? (
        <p role="alert" className="card text-error p-4 text-sm">
          Could not load your statistics: {error}
        </p>
      ) : !data ? (
        <p className="card text-muted p-4 text-sm">Reading your local database…</p>
      ) : empty ? (
        <p className="card text-muted p-4 text-sm">
          Finish a test and your accuracy, weak clusters and hesitation keys show up here.
        </p>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <Trend
              title="Accuracy"
              caption="last 30 sessions"
              points={data.trend.map((t) => t.accuracy * 100)}
              labels={data.trend.map((t) => new Date(t.startedAt).toLocaleDateString())}
              format={(v) => `${Math.round(v)}%`}
              zeroBased
            />
            {/*
              Sessions saved before wpm was recorded are dropped from this
              chart rather than plotted at zero or converted from their cpm:
              cpm counts codepoints and wpm counts clusters, and no fixed ratio
              turns one into the other. A missing point is honest; an invented
              one would put a dip in the trend that never happened.
            */}
            <Trend
              title="WPM"
              caption={`${WORDS_CAPTION} · last 30 sessions`}
              points={withWpm.map((t) => t.wpm)}
              labels={withWpm.map((t) => new Date(t.startedAt).toLocaleDateString())}
              format={(v) => String(Math.round(v))}
              zeroBased
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <Ranked
              title="Weakest clusters"
              caption="lowest accuracy first"
              unit="accuracy"
              rows={data.clusters.map((c) => ({
                key: c.cluster,
                glyph: c.cluster,
                value: c.correct / c.attempts,
                label: `${Math.round((c.correct / c.attempts) * 100)}%`,
                // A short bar must mean "worse", so plot the error rate.
                bar: 1 - c.correct / c.attempts,
                title: `${c.correct} of ${c.attempts} correct`,
              }))}
            />

            <Ranked
              title="Subscript consonants"
              caption="most mistyped, recent mistakes count more"
              unit="weighted errors"
              rows={data.subscripts.map((s) => ({
                key: s.codepoint,
                glyph: DOTTED_CIRCLE + COENG + s.codepoint,
                value: s.weightedErrors,
                label: s.weightedErrors.toFixed(1),
                bar: s.weightedErrors,
                title: `${s.attempts - s.correct} of ${s.attempts} mistyped`,
              }))}
            />

            <Ranked
              title="Hesitation keys"
              caption="slowest to reach, right or wrong"
              unit="mean ms"
              rows={data.slowest.map((c) => ({
                key: c.codepoint,
                glyph: c.codepoint,
                value: c.meanMs,
                label: `${Math.round(c.meanMs)}ms`,
                bar: c.meanMs,
                title: `${c.attempts} attempts`,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * A single-series line. Two measures of different scale get two charts, never
 * two y-axes on one plot — the alignment of a second scale is arbitrary and
 * invents a correlation the data does not contain.
 */
function Trend({
  title,
  caption,
  points,
  labels,
  format,
  zeroBased = false,
}: {
  title: string;
  caption: string;
  points: number[];
  labels: string[];
  format: (value: number) => string;
  zeroBased?: boolean;
}) {
  const latest = points[points.length - 1];

  // One point is not a trend; a one-point line chart is a stat tile wearing a
  // costume, so show the number instead.
  if (points.length < 2) {
    return (
      <figure className="card p-4">
        <figcaption className="text-muted text-xs">
          {title} <span className="opacity-70">· {caption}</span>
        </figcaption>
        <p className="text-caret mt-2 text-3xl tabular-nums">
          {latest === undefined ? '—' : format(latest)}
        </p>
        <p className="text-muted mt-1 text-xs">One session so far — a trend needs two.</p>
      </figure>
    );
  }

  const W = 300;
  const H = 90;
  const pad = { left: 34, right: 10, top: 10, bottom: 20 };
  const max = Math.max(...points);
  const min = zeroBased ? 0 : Math.min(...points);
  const span = max - min || 1;

  const x = (i: number) => pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - min) / span) * (H - pad.top - pad.bottom);
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <figure className="card p-4">
      <figcaption className="text-muted text-xs">
        {title} <span className="opacity-70">· {caption}</span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full overflow-visible"
        role="img"
        aria-label={`${title} across ${points.length} sessions, from ${format(points[0] ?? 0)} to ${format(latest ?? 0)}`}
      >
        {/* Solid hairlines, one shade off the surface. Dashes read as a threshold. */}
        {[max, min].map((v) => (
          <line
            key={v}
            x1={pad.left}
            x2={W - pad.right}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {[max, min].map((v) => (
          <text
            key={v}
            x={pad.left - 6}
            y={y(v) + 3}
            textAnchor="end"
            className="fill-muted"
            style={{ fontSize: 9 }}
          >
            {format(v)}
          </text>
        ))}

        <path
          d={path}
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Only the endpoint is marked and labelled — a number on every point is chaos. */}
        <circle cx={x(points.length - 1)} cy={y(latest ?? 0)} r={3.5} fill={SERIES} />

        {/* Invisible, generously sized hover targets carrying the native tooltip. */}
        {points.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={8} fill="transparent">
            <title>{`${labels[i] ?? ''}: ${format(v)}`}</title>
          </circle>
        ))}

        <text x={pad.left} y={H - 6} className="fill-muted" style={{ fontSize: 9 }}>
          {labels[0]}
        </text>
        <text x={W - pad.right} y={H - 6} textAnchor="end" className="fill-muted" style={{ fontSize: 9 }}>
          {labels[labels.length - 1]}
        </text>
      </svg>
    </figure>
  );
}

interface Row {
  key: string;
  glyph: string;
  value: number;
  label: string;
  bar: number;
  title: string;
}

/**
 * A ranked magnitude list. Every bar takes the same hue: darkening by value
 * would double-encode bar length as colour and burn the only free channel on
 * information the chart already shows.
 */
function Ranked({
  title,
  caption,
  unit,
  rows,
}: {
  title: string;
  caption: string;
  unit: string;
  rows: Row[];
}) {
  if (rows.length === 0) {
    return (
      <figure className="card p-4">
        <figcaption className="text-muted text-xs">
          {title} <span className="opacity-70">· {caption}</span>
        </figcaption>
        <p className="text-muted mt-2 text-xs">Not enough data yet.</p>
      </figure>
    );
  }

  const widest = Math.max(...rows.map((r) => r.bar)) || 1;

  return (
    <figure className="card p-4">
      <figcaption className="text-muted text-xs">
        {title} <span className="opacity-70">· {caption}</span>
      </figcaption>

      <table className="mt-3 w-full">
        <caption className="sr-only">
          {title} — {caption}, measured in {unit}
        </caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} title={row.title}>
              <th
                scope="row"
                className="font-khmer w-10 py-1 text-left text-xl font-normal"
                lang="km"
              >
                {row.glyph}
              </th>
              <td className="w-full py-1">
                <div
                  className="bg-caret h-1.5 rounded-full"
                  style={{ width: `${Math.max(2, (row.bar / widest) * 100)}%` }}
                />
              </td>
              <td className="text-muted w-14 py-1 text-right font-mono text-xs tabular-nums">
                {row.label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
