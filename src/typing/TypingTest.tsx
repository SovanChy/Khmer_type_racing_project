import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildPassage, loadCorpus, type CorpusEntry } from '../corpus';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import type { KeyAction } from '../keyboard/nida';
import {
  countCorrectClusters,
  countCorrectCodepoints,
  score,
  wordProps,
  CLUSTERS_PER_WORD,
} from './engine';
import { Word, wordRenders } from './Word';

const TIME_PRESETS = [15, 30, 60] as const;
const WORD_PRESETS = [25, 50, 100] as const;

/** Long enough that even a fast typist cannot run out during a 60s test. */
const TIMED_PASSAGE_WORDS = 150;

type TestConfig =
  | { kind: 'time'; seconds: (typeof TIME_PRESETS)[number] }
  | { kind: 'words'; count: (typeof WORD_PRESETS)[number] };

type Phase = 'idle' | 'running' | 'done';

interface Stats {
  /** Keypresses that were right when pressed, including ones later erased. */
  correctPresses: number;
  totalPresses: number;
  startedAt: number;
  endedAt: number;
}

const freshStats = (): Stats => ({ correctPresses: 0, totalPresses: 0, startedAt: 0, endedAt: 0 });

export function TypingTest() {
  const [corpus, setCorpus] = useState<CorpusEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<TestConfig>({ kind: 'time', seconds: 30 });
  const [words, setWords] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');

  // The one piece of state a keystroke touches. Which word is active and what
  // each word displays both derive from this number, so nothing else has to move.
  const [caret, setCaret] = useState(0);

  // The full typed buffer and the running counters live in refs: mutating them
  // costs no render, which is what keeps a keypress off the rest of the passage.
  const typed = useRef<string[]>([]);
  const stats = useRef<Stats>(freshStats());

  const target = useMemo(() => words.join(''), [words]);
  const targetCps = useMemo(() => [...target], [target]);

  useEffect(() => {
    let cancelled = false;
    loadCorpus()
      .then((entries) => !cancelled && setCorpus(entries))
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const restart = useCallback(() => {
    if (!corpus) return;
    typed.current = [];
    stats.current = freshStats();
    setWords(buildPassage(corpus, config.kind === 'words' ? config.count : TIMED_PASSAGE_WORDS));
    setCaret(0);
    setPhase('idle');
  }, [corpus, config]);

  // Also fires when the corpus arrives or the config changes, which is exactly
  // when a fresh passage is wanted.
  useEffect(() => restart(), [restart]);

  // A timed test ends on the clock; a word test ends when the passage runs out.
  useEffect(() => {
    if (phase !== 'running' || config.kind !== 'time') return;
    const id = setTimeout(() => {
      stats.current.endedAt = performance.now();
      setPhase('done');
    }, config.seconds * 1000);
    return () => clearTimeout(id);
  }, [phase, config]);

  function handleAction(action: KeyAction) {
    if (phase === 'done' || targetCps.length === 0) return;
    const buffer = typed.current;

    if (action.type === 'backspace') {
      if (buffer.length === 0) return;
      buffer.pop();
      setCaret(buffer.length);
      return;
    }

    if (action.type !== 'char' || buffer.length >= targetCps.length) return;

    if (phase === 'idle') {
      stats.current.startedAt = performance.now();
      setPhase('running');
    }

    stats.current.totalPresses += 1;
    if (action.cp === targetCps[buffer.length]) stats.current.correctPresses += 1;
    buffer.push(action.cp);
    setCaret(buffer.length);

    if (buffer.length >= targetCps.length) {
      stats.current.endedAt = performance.now();
      setPhase('done');
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="border-error/50 bg-error/10 text-error rounded-md border p-3 text-sm">
        Could not load the corpus: {loadError}
      </p>
    );
  }
  if (corpus === null) return <p className="text-muted text-sm">Loading corpus…</p>;

  const typedText = typed.current.join('');
  // ponytail: rescans the whole buffer each keystroke. At 150 words (~750
  // codepoints) that is far under a frame; track it incrementally only if a
  // much longer passage ever makes it show up.
  const correctCp = countCorrectCodepoints(target, typedText);

  return (
    <section className="space-y-6">
      <ConfigBar config={config} onChange={setConfig} />

      <LiveStats
        phase={phase}
        config={config}
        correctCp={correctCp}
        correctPresses={stats.current.correctPresses}
        totalPresses={stats.current.totalPresses}
        startedAt={stats.current.startedAt}
        endedAt={stats.current.endedAt}
        caret={caret}
        totalCps={targetCps.length}
      />

      <KeyboardInput onAction={handleAction}>
        <p className="font-khmer text-2xl leading-[2.2] sm:text-3xl" lang="km">
          {wordProps(words, typed.current, caret).map((props, i) => (
            <Word key={i} {...props} />
          ))}
        </p>
      </KeyboardInput>

      {/* Immediately after the input in DOM order, so Tab then Enter restarts. */}
      <button
        onClick={restart}
        className="border-border text-muted hover:text-fg hover:border-fg/30 focus-visible:ring-caret cursor-pointer rounded-md border px-4 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        Restart <span className="opacity-60">(Tab, then Enter)</span>
      </button>

      {phase === 'done' && (
        <Results
          target={target}
          typedText={typedText}
          correctCp={correctCp}
          stats={stats.current}
          onRestart={restart}
        />
      )}

      {import.meta.env.DEV && <RenderCounter wordCount={words.length} />}
    </section>
  );
}

function ConfigBar({
  config,
  onChange,
}: {
  config: TestConfig;
  onChange: (config: TestConfig) => void;
}) {
  const chip = (selected: boolean) =>
    `cursor-pointer rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caret ${
      selected ? 'bg-caret/15 text-caret' : 'text-muted hover:text-fg'
    }`;

  return (
    <div className="border-border flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border px-3 py-2 font-mono text-sm">
      <div role="radiogroup" aria-label="Timed test length" className="flex items-center gap-1">
        <span className="text-muted mr-1 text-xs">time</span>
        {TIME_PRESETS.map((seconds) => (
          <button
            key={seconds}
            role="radio"
            aria-checked={config.kind === 'time' && config.seconds === seconds}
            onClick={() => onChange({ kind: 'time', seconds })}
            className={chip(config.kind === 'time' && config.seconds === seconds)}
          >
            {seconds}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Word count test length" className="flex items-center gap-1">
        <span className="text-muted mr-1 text-xs">words</span>
        {WORD_PRESETS.map((count) => (
          <button
            key={count}
            role="radio"
            aria-checked={config.kind === 'words' && config.count === count}
            onClick={() => onChange({ kind: 'words', count })}
            className={chip(config.kind === 'words' && config.count === count)}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Ticks on its own timer so the clock keeps moving between keystrokes. Counts
 * arrive as plain numbers from the parent, which only recomputes them when a key
 * is actually pressed.
 */
function LiveStats({
  phase,
  config,
  correctCp,
  correctPresses,
  totalPresses,
  startedAt,
  endedAt,
  caret,
  totalCps,
}: {
  phase: Phase;
  config: TestConfig;
  correctCp: number;
  correctPresses: number;
  totalPresses: number;
  startedAt: number;
  endedAt: number;
  caret: number;
  totalCps: number;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase]);

  const ms = phase === 'idle' ? 0 : (endedAt || performance.now()) - startedAt;
  const live = score({ correctCp, correctClusters: 0, correctPresses, totalPresses, ms });

  const progress =
    config.kind === 'time'
      ? `${Math.max(0, Math.ceil(config.seconds - ms / 1000))}s`
      : `${caret}/${totalCps}`;

  return (
    <div className="flex items-baseline gap-6 font-mono text-sm" aria-live="off">
      <span className="text-caret text-2xl tabular-nums">{progress}</span>
      <span className="text-muted">
        <span className="text-fg tabular-nums">{Math.round(live.cpm)}</span> cpm
      </span>
      <span className="text-muted">
        <span className="text-fg tabular-nums">{Math.round(live.accuracy * 100)}</span>% acc
      </span>
    </div>
  );
}

function Results({
  target,
  typedText,
  correctCp,
  stats,
  onRestart,
}: {
  target: string;
  typedText: string;
  correctCp: number;
  stats: Stats;
  onRestart: () => void;
}) {
  const final = score({
    correctCp,
    correctClusters: countCorrectClusters(target, typedText),
    correctPresses: stats.correctPresses,
    totalPresses: stats.totalPresses,
    ms: stats.endedAt - stats.startedAt,
  });

  return (
    <div className="border-border bg-surface space-y-4 rounded-lg border p-6">
      <h2 className="text-muted text-sm font-medium">Result</h2>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="cpm" hint="correct keystrokes / min" value={Math.round(final.cpm)} primary />
        <Stat label="wpm" hint={`${CLUSTERS_PER_WORD} clusters = 1 word`} value={Math.round(final.wpm)} />
        <Stat label="accuracy" hint="of all keypresses" value={`${Math.round(final.accuracy * 100)}%`} />
        <Stat
          label="keystrokes"
          hint="correct / total"
          value={`${stats.correctPresses}/${stats.totalPresses}`}
        />
      </dl>

      <p className="text-muted text-xs">
        CPM counts keystrokes, not Latin-style words. The wpm figure uses a local convention of{' '}
        {CLUSTERS_PER_WORD} Khmer clusters per word and is <strong>not</strong> comparable to a
        MonkeyType Latin score.
      </p>

      <button
        onClick={onRestart}
        className="bg-caret/15 text-caret hover:bg-caret/25 focus-visible:ring-caret cursor-pointer rounded-md px-4 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        Go again
      </button>
    </div>
  );
}

function Stat({
  label,
  hint,
  value,
  primary = false,
}: {
  label: string;
  hint: string;
  value: string | number;
  primary?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted font-mono text-xs">{label}</dt>
      <dd className={`tabular-nums ${primary ? 'text-caret text-4xl' : 'text-fg text-2xl'}`}>
        {value}
      </dd>
      <p className="text-muted mt-0.5 text-[0.7rem] opacity-70">{hint}</p>
    </div>
  );
}

/**
 * Writes straight to the DOM rather than through state — an instrument that
 * re-rendered React would perturb the very thing it is measuring.
 */
function RenderCounter({ wordCount }: { wordCount: number }) {
  const output = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);

  useEffect(() => {
    if (output.current) output.current.textContent = String(wordRenders.count - previous.current);
    previous.current = wordRenders.count;
  });

  return (
    <p className="text-muted font-mono text-xs opacity-70">
      dev · &lt;Word&gt; renders on last update: <span ref={output}>0</span> of {wordCount} · a
      number near {wordCount} means the passage re-rendered (StrictMode doubles this)
    </p>
  );
}
