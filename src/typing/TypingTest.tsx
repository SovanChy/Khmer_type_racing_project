import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  buildDrillPassage,
  buildPassage,
  loadCorpus,
  MAX_QUOTE_WORDS,
  parseQuote,
  type CorpusEntry,
  type ParsedQuote,
} from '../corpus';
import { HINT_KEYS, KeyboardHint } from '../keyboard/KeyboardHint';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import type { KeyAction } from '../keyboard/nida';
import {
  countCorrectClusters,
  countCorrectCodepoints,
  elapsedMs,
  endReason,
  score,
  targetSites,
  wordProps,
  CLUSTERS_PER_WORD,
  type Score,
} from './engine';
import { Word, wordRenders } from './Word';
import { saveSession, worstClusters, type KeystrokeRecord } from '../storage';
import { useStore } from '../store';
import { Definition } from '../dict/Definition';
import { foldWord } from '../dict';

/**
 * How hard drill mode leans on weak clusters, against a baseline weight of 1
 * per corpus entry. Higher concentrates practice; lower keeps more variety.
 */
const DRILL_STRENGTH = 4;

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
  /** performance.now() — monotonic, for measuring elapsed time. */
  startedAt: number;
  endedAt: number;
  /** Date.now() — wall clock, for storing when the run happened. */
  startedAtEpoch: number;
  /**
   * Total time spent paused (blurred) so far, in ms. Subtracted from
   * `endedAt - startedAt` everywhere elapsed time is computed, rather than
   * shifting `startedAt` itself — one accumulator is simpler than rewriting a
   * monotonic anchor every time focus returns.
   */
  pausedMs: number;
}

const freshStats = (): Stats => ({
  correctPresses: 0,
  totalPresses: 0,
  startedAt: 0,
  endedAt: 0,
  startedAtEpoch: 0,
  pausedMs: 0,
});

export function TypingTest() {
  const noteSessionSaved = useStore((s) => s.noteSessionSaved);
  const showKeyboard = useStore((s) => s.showKeyboard);
  const setShowKeyboard = useStore((s) => s.setShowKeyboard);
  const quote = useStore((s) => s.quote);
  const setQuote = useStore((s) => s.setQuote);
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

  // Buffered, never written per keypress: a worker round trip on every
  // keystroke would be both slow and pointless when the whole run is saved at
  // the end as one transaction.
  const keystrokes = useRef<KeystrokeRecord[]>([]);
  const lastKeyAt = useRef(0);
  const savedFor = useRef(-1);
  const [saveState, setSaveState] = useState<{ kind: 'saving' | 'saved' | 'error'; message?: string }>();

  // Blurring the input pauses a running test (F-11): the timer must stop and
  // elapsed time must not include the blurred interval. `paused` is only ever
  // true while `phase === 'running'`. `pauseStartedAt` is a ref (not state) —
  // it's an implementation detail of the accumulator, not something anything
  // renders from.
  const [paused, setPaused] = useState(false);
  const pauseStartedAt = useRef<number | null>(null);

  const [drill, setDrill] = useState(false);

  /** R4: the word whose definition is open, or null. */
  const [definition, setDefinition] = useState<string | null>(null);

  // R3: parsed once per quote, not once per restart — the strip/count shown in
  // the config bar and the passage itself must come from the same parse.
  const parsedQuote = useMemo(() => (quote === null ? null : parseQuote(quote)), [quote]);

  // The passage is a fixed-height window (see the JSX); this keeps the active
  // word inside it. A DOM query rather than React state on purpose: scrolling
  // is not something any component renders from, and routing it through state
  // would re-render the passage on every keystroke.
  const passage = useRef<HTMLParagraphElement>(null);
  const more = useRef<HTMLSpanElement>(null);

  // In a ref, not state: refreshing the weights must not rebuild the passage
  // mid-run or wipe the results screen the user is still reading.
  const weights = useRef<Map<string, number>>(new Map());

  const target = useMemo(() => words.join(''), [words]);
  const targetCps = useMemo(() => [...target], [target]);
  const sites = useMemo(() => targetSites(target), [target]);

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
    if (!parsedQuote && !corpus) return;
    typed.current = [];
    stats.current = freshStats();
    keystrokes.current = [];
    lastKeyAt.current = 0;
    pauseStartedAt.current = null;
    setPaused(false);
    setSaveState(undefined);

    if (parsedQuote) {
      // R3: the quote IS the passage. Its length is whatever the user pasted,
      // so the time/word presets do not apply — see the countdown effect.
      setWords(parsedQuote.words);
    } else if (corpus) {
      const count = config.kind === 'words' ? config.count : TIMED_PASSAGE_WORDS;
      setWords(
        drill ? buildDrillPassage(corpus, weights.current, count) : buildPassage(corpus, count),
      );
    }
    setCaret(0);
    setPhase('idle');
  }, [corpus, config, drill, parsedQuote]);

  // Also fires when the corpus arrives or the config changes, which is exactly
  // when a fresh passage is wanted.
  useEffect(() => restart(), [restart]);

  // Keep the active word inside the passage window. `block: 'nearest'` scrolls
  // the minimum needed, so a word already on screen moves nothing — without it
  // every keystroke would yank the whole page.
  //
  // The "…" marker is toggled here rather than rendered from state: it has to
  // be decided from the post-scroll scroll position, which only exists after
  // the DOM has settled, and a state update would re-render the passage on
  // every keystroke. Same reasoning as RenderCounter below.
  useEffect(() => {
    // Not named `window`: shadowing the global would make the codebase-wide
    // grep for `window` handlers (a privacy rule in CLAUDE.md) return noise.
    const view = passage.current;
    view?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
    if (!view || !more.current) return;
    // The 1px slack absorbs sub-pixel line heights, which otherwise leave a
    // fully-scrolled window looking like it still has text below.
    const hasMore = view.scrollTop + view.clientHeight < view.scrollHeight - 1;
    // visibility, not display: hiding it must not move the keyboard below.
    more.current.style.visibility = hasMore ? 'visible' : 'hidden';
  }, [caret, words]);

  // A timed test ends on the clock; a word test ends when the passage runs out.
  // Recomputed from scratch on every pause/resume so the remaining time — not
  // the original duration — is what gets scheduled, and nothing is scheduled
  // at all while paused.
  useEffect(() => {
    // A quote ends when its last codepoint is typed (see handleAction), so no
    // countdown runs against it — cutting a quote off mid-sentence at 30s is
    // the opposite of what "type this article" means.
    if (phase !== 'running' || config.kind !== 'time' || paused || quote !== null) return;
    const elapsed = elapsedMs({
      startedAt: stats.current.startedAt,
      endedAt: performance.now(),
      pausedMs: stats.current.pausedMs,
    });
    const remaining = config.seconds * 1000 - elapsed;
    if (remaining <= 0) {
      stats.current.endedAt = performance.now();
      setPhase('done');
      return;
    }
    const id = setTimeout(() => {
      stats.current.endedAt = performance.now();
      setPhase('done');
    }, remaining);
    return () => clearTimeout(id);
  }, [phase, config, paused, quote]);

  /**
   * R4: open the dictionary on the word that was clicked.
   *
   * Deliberately does not stop the click from reaching the input card, which
   * focuses the typing field — looking a word up mid-run must not cost the
   * user their focus, and therefore must not pause the run.
   */
  function handleWordClick(e: ReactMouseEvent<HTMLParagraphElement>) {
    const hit = (e.target as HTMLElement).closest('[data-word]');
    const word = hit?.getAttribute('data-word');
    // A passage word can be bare punctuation — `។` is its own word. There is
    // nothing to look up, so open nothing rather than a panel saying so.
    if (word && foldWord(word) !== '') setDefinition(word);
  }

  /** Blur pauses a running test — see the `Stats.pausedMs` comment for why. */
  function handleInputBlur() {
    if (phase !== 'running') return;
    pauseStartedAt.current = performance.now();
    setPaused(true);
  }

  function handleInputFocus() {
    if (pauseStartedAt.current === null) return;
    stats.current.pausedMs += performance.now() - pauseStartedAt.current;
    pauseStartedAt.current = null;
    // Otherwise the next keystroke's msSincePrev would read as tens of
    // seconds of "hesitation" instead of the pause it actually was. 0 has the
    // same meaning here as it does for the very first keystroke of a run: no
    // previous keystroke to measure a gap from.
    lastKeyAt.current = 0;
    setPaused(false);
  }

  /** Final numbers for the run. One definition, so the saved row and the screen agree. */
  const finalScore = useCallback(() => {
    const typedText = typed.current.join('');
    return score({
      correctCp: countCorrectCodepoints(target, typedText),
      correctClusters: countCorrectClusters(target, typedText),
      correctPresses: stats.current.correctPresses,
      totalPresses: stats.current.totalPresses,
      ms: elapsedMs({
        startedAt: stats.current.startedAt,
        endedAt: stats.current.endedAt,
        pausedMs: stats.current.pausedMs,
      }),
    });
  }, [target]);

  // Refreshed after each save so a drill reflects the run just finished.
  useEffect(() => {
    worstClusters(20).then(
      (stats) => {
        weights.current = new Map(
          stats.map((s) => [s.cluster, (1 - s.correct / s.attempts) * DRILL_STRENGTH]),
        );
      },
      () => {
        weights.current = new Map();
      },
    );
  }, [saveState]);

  useEffect(() => {
    if (phase !== 'done') return;
    // Exactly one save per run, whatever makes this effect re-run.
    if (savedFor.current === stats.current.startedAtEpoch) return;
    savedFor.current = stats.current.startedAtEpoch;

    const final = finalScore();
    setSaveState({ kind: 'saving' });

    saveSession(
      {
        startedAt: stats.current.startedAtEpoch,
        mode: config.kind === 'time' ? `time:${config.seconds}` : `words:${config.count}`,
        durationMs: Math.round(
          elapsedMs({
            startedAt: stats.current.startedAt,
            endedAt: stats.current.endedAt,
            pausedMs: stats.current.pausedMs,
          }),
        ),
        cpm: final.cpm,
        wpm: final.wpm,
        accuracy: final.accuracy,
      },
      keystrokes.current,
    ).then(
      () => {
        setSaveState({ kind: 'saved' });
        noteSessionSaved(); // tells the analytics panels there is new data
      },
      (e: unknown) =>
        setSaveState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [phase, config, finalScore]);

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
      stats.current.startedAtEpoch = Date.now();
      setPhase('running');
    }

    const site = sites[buffer.length];
    const wanted = site?.codepoint ?? null;
    const correct = action.cp === wanted;
    const now = performance.now();

    stats.current.totalPresses += 1;
    if (correct) stats.current.correctPresses += 1;

    keystrokes.current.push({
      targetCodepoint: wanted,
      // Recorded now because it cannot be recovered from the stored row later.
      targetCluster: site?.cluster ?? null,
      subscript: site?.subscript ?? false,
      typedCodepoint: action.cp,
      correct,
      // Zero on the first keystroke — there is no previous one to measure from.
      msSincePrev: lastKeyAt.current === 0 ? 0 : Math.round(now - lastKeyAt.current),
    });
    lastKeyAt.current = now;

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

  const currentWordProps = wordProps(words, typed.current, caret);

  // R5: why the run stopped. Derived, not stored — see `endReason`.
  const ended = endReason(
    phase === 'done',
    config.kind === 'time' && quote === null,
    caret,
    targetCps.length,
  );

  // The character the last keypress should have produced but didn't. Read
  // straight off the buffer rather than kept in state: the caret already
  // re-renders this component every keystroke, so deriving it costs nothing
  // and cannot drift out of sync with what was actually typed. Clears itself
  // as soon as the next press lands correctly, or backspace walks back over it.
  const missedCp =
    caret > 0 && typed.current[caret - 1] !== sites[caret - 1]?.codepoint
      ? (sites[caret - 1]?.codepoint ?? null)
      : null;

  // R2 strip, fed the WHOLE passage rather than just the active word: with a
  // lookahead it has to be able to run past the end of a word, because the
  // keyboard hint does — the hint's five keys routinely include the space and
  // the start of the next word, and a strip that stopped at the word boundary
  // would show a shorter window than the diagram it is meant to agree with.
  //
  // Costs one more full-passage compare() per keystroke. Same reasoning as
  // countCorrectCodepoints above: ~750 codepoints is far under a frame, and
  // this is outside <Word>'s props, so the one-render-per-keypress invariant
  // is untouched.

  return (
    <section className="space-y-6">
      <ConfigBar
        config={config}
        onChange={setConfig}
        drill={drill}
        onDrillChange={setDrill}
        showKeyboard={showKeyboard}
        onShowKeyboardChange={setShowKeyboard}
        quote={quote}
        parsed={parsedQuote}
        onQuoteChange={setQuote}
      />

      <LiveStats
        phase={phase}
        config={config}
        correctCp={correctCp}
        correctPresses={stats.current.correctPresses}
        totalPresses={stats.current.totalPresses}
        startedAt={stats.current.startedAt}
        endedAt={stats.current.endedAt}
        pausedMs={stats.current.pausedMs}
        paused={paused}
        caret={caret}
        totalCps={targetCps.length}
        quoteMode={quote !== null}
      />

      {/*
        Passage and keyboard side by side from `xl` up, stacked below it.
        Stacking cost about 500px of height, which pushed the keyboard off the
        bottom of a short laptop screen exactly when a learner needs to see the
        text and the key at the same moment. Splitting is only possible on a
        wide viewport — the diagram's narrowest row is ~776px and does not
        usefully shrink — so this is a two-column layout where there is room
        and the old stack everywhere else.
      */}
      {/*
        [&>*]:min-w-0 is load-bearing, not tidying: a grid item defaults to
        min-width:auto, so the keyboard panel would refuse to shrink below its
        ~810px content and push the whole PAGE into horizontal scroll on a
        phone. Zeroing the floor hands the overflow back to the panel's own
        overflow-x-auto, where it belongs.
      */}
      <div className="grid gap-6 [&>*]:min-w-0 wide:grid-cols-[minmax(24rem,1fr)_auto] wide:items-start">
      {/* The passage column: the text and, when asked for, what a word means. */}
      <div className="space-y-4">
      <KeyboardInput
        onAction={handleAction}
        paused={paused}
        ended={ended}
        onBlur={handleInputBlur}
        onFocus={handleInputFocus}
      >
        {/*
          A fixed three-line window, not the whole passage. A 150-word timed
          passage is ~25 lines at any readable column width, which pushes the
          keyboard hint and the results screen below the fold — so the passage
          scrolls under the caret instead of growing. `overflow-hidden` still
          scrolls programmatically; making it `auto` would let the user scroll
          the text out of sync with what they are typing.

          The height is in `em` so it tracks the responsive font size, and the
          multiplier is the `leading` value: 3 lines exactly, whatever the
          breakpoint. Changing one without the other silently clips a line.
        */}
        {/*
          Dimmed once the run is over: the passage is the thing being stared
          at, so it is the thing that has to stop looking live.
        */}
        <p
          ref={passage}
          // R4: one handler for the whole passage, reading the word off the
          // element that was hit. A click handler per <Word> would be a new
          // function identity every render and would re-render the passage on
          // every keystroke — see the memo note in Word.tsx.
          onClick={handleWordClick}
          className={`font-khmer h-[6.6em] overflow-hidden text-2xl leading-[2.2] sm:text-3xl ${
            ended ? 'opacity-50' : ''
          }`}
          lang="km"
        >
          {currentWordProps.map((props, i) => (
            <Word key={i} {...props} />
          ))}
        </p>

        {/*
          "there is more passage below this window". Hidden, not unmounted, by
          the scroll effect above. aria-hidden because it is a visual affordance
          for a clipped box — every word is in the DOM either way, so a screen
          reader has nothing to be told here.
        */}
        <span
          ref={more}
          aria-hidden
          className="text-muted block text-right font-mono text-sm leading-none"
          style={{ visibility: 'hidden' }}
        >
          …
        </span>

      </KeyboardInput>

        {/*
          R4: under the passage and inside its column, so the word and its
          meaning read together at every width — in the two-column layout the
          keyboard diagram would otherwise sit between them. Absent from the
          DOM entirely until a word is tapped.
        */}
        {definition !== null && (
          <Definition word={definition} onClose={() => setDefinition(null)} />
        )}
      </div>

      {showKeyboard && (
        <KeyboardHint
          // Nothing is "next" once the run is over. A diagram still lighting up
          // a key you can no longer type is the same lie the input was telling.
          nextCps={ended ? [] : sites.slice(caret, caret + HINT_KEYS).map((s) => s.codepoint)}
          missedCp={ended ? null : missedCp}
        />
      )}
      </div>

      {/* Immediately after the input in DOM order, so Tab then Enter restarts. */}
      <button
        onClick={restart}
        className="border-border text-muted hover:text-fg hover:border-fg/30 focus-visible:ring-caret cursor-pointer rounded-md border px-4 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        Restart <span className="opacity-60">(Tab, then Enter)</span>
      </button>

      {phase === 'done' && (
        <Results
          final={finalScore()}
          stats={stats.current}
          saveState={saveState}
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
  drill,
  onDrillChange,
  showKeyboard,
  onShowKeyboardChange,
  quote,
  parsed,
  onQuoteChange,
}: {
  config: TestConfig;
  onChange: (config: TestConfig) => void;
  drill: boolean;
  onDrillChange: (drill: boolean) => void;
  showKeyboard: boolean;
  onShowKeyboardChange: (show: boolean) => void;
  quote: string | null;
  parsed: ParsedQuote | null;
  onQuoteChange: (quote: string | null) => void;
}) {
  // A pasted quote is its own length and its own text, so neither a duration,
  // a word count nor a drill weighting has anything left to act on.
  const locked = quote !== null;

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
      <Segmented
        label="time"
        unit="s"
        ariaLabel="Timed test length"
        options={TIME_PRESETS}
        selected={config.kind === 'time' ? config.seconds : null}
        onSelect={(seconds) => onChange({ kind: 'time', seconds })}
        disabled={locked}
      />

      <Segmented
        label="words"
        ariaLabel="Word count test length"
        options={WORD_PRESETS}
        selected={config.kind === 'words' ? config.count : null}
        onSelect={(count) => onChange({ kind: 'words', count })}
        disabled={locked}
      />

      <span aria-hidden className="bg-border hidden h-7 w-px sm:block" />

      <Toggle
        checked={drill}
        onChange={() => onDrillChange(!drill)}
        disabled={locked}
        title="Draw sentences that are denser in the clusters you get wrong"
      >
        drill
      </Toggle>

      <Toggle
        checked={showKeyboard}
        onChange={() => onShowKeyboardChange(!showKeyboard)}
        title="Show an on-screen keyboard diagram of the next key to press"
      >
        keyboard
      </Toggle>

      <QuoteControl quote={quote} parsed={parsed} onQuoteChange={onQuoteChange} />
    </div>
  );
}

/**
 * A pick-one group, drawn as a segmented control on a recessed track.
 *
 * The three control kinds in this bar (pick-one, on/off, action) used to share
 * one chip style, which made the bar unreadable — you could not tell what a
 * button would DO from looking at it. Each now has its own shape: this one is
 * a group of segments sharing a track, so it reads as a set of alternatives.
 *
 * Text stays `--fg` on the selected segment rather than switching to the green
 * accent: the accent carries the "this one" meaning through the tint and ring,
 * while the label keeps full contrast. Green-on-white is only ~3.6:1, under the
 * 4.5:1 small text needs.
 */
function Segmented<T extends number>({
  label,
  unit = '',
  ariaLabel,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  unit?: string;
  ariaLabel: string;
  options: readonly T[];
  selected: T | null;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={`bg-key flex items-center gap-0.5 rounded-lg p-0.5 ${disabled ? 'opacity-40' : ''}`}
      >
        {options.map((value) => {
          const on = selected === value;
          return (
            <button
              key={value}
              role="radio"
              aria-checked={on}
              onClick={() => onSelect(value)}
              disabled={disabled}
              className={`focus-visible:ring-caret cursor-pointer rounded-md px-2.5 py-1 font-mono text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed ${
                on
                  ? 'bg-caret text-bg font-semibold'
                  : 'text-muted hover:text-fg'
              }`}
            >
              {value}
              {unit}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * An on/off switch. `role="switch"` already said so to a screen reader; the
 * dot is what says it to everyone else — a filled dot for on, a hollow ring
 * for off, so the state survives greyscale and colour blindness instead of
 * resting on a green tint alone.
 */
function Toggle({
  checked,
  onChange,
  disabled,
  title,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={`focus-visible:ring-caret flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 font-mono text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'border-caret text-fg' : 'border-border text-muted hover:text-fg'
      }`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${
          checked ? 'bg-caret' : 'border-muted border bg-transparent'
        }`}
      />
      {children}
    </button>
  );
}

/**
 * R3: paste your own text to type instead of the corpus.
 *
 * A native `<details>` rather than a boolean in state — the browser already
 * owns "is this panel open", and the summary is styled as a chip so it reads
 * as a fourth mode in the config row rather than something tucked away.
 *
 * The textarea has no `onKeyDown` and no remap: it is an ordinary paste
 * target, so the typing input stays the only surface in the app that captures
 * keystrokes. See the input-handler rule in CLAUDE.md.
 */
function QuoteControl({
  quote,
  parsed,
  onQuoteChange,
}: {
  quote: string | null;
  parsed: ParsedQuote | null;
  onQuoteChange: (quote: string | null) => void;
}) {
  const [draft, setDraft] = useState(quote ?? '');

  return (
    <details className="w-full">
      {/*
        The only action in a bar of settings, so it gets the third and last
        visual language: a dashed "+" outline, the conventional "add content
        here" affordance, sharing nothing with the segments or the switches.
        Deliberately NOT filled with the green accent — that accent means
        "selected" everywhere else in this bar, and white on it is only ~4:1.
        The solid commit button lives inside the panel, one step later.
      */}
      <summary className="border-border hover:border-fg/30 focus-visible:ring-caret text-fg -mx-1 flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg border-2 border-dashed px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none">
        <span aria-hidden className="text-base leading-none">+</span>
        {quote === null ? 'Insert your own text' : 'Your own text'}
        {quote !== null && (
          <span className="bg-caret/20 text-fg ring-caret rounded-full px-2 py-0.5 font-mono text-xs ring-1">
            in use
          </span>
        )}
      </summary>

      <div className="mt-2 space-y-2">
        {/*
          Placed above the textarea, not below it: a caution under the box is
          read after the paste it was meant to prevent.

          It says what actually happens rather than only disclaiming, because
          the concrete fact is the part that changes behaviour — pasted text
          and the keystrokes typed against it are written to this browser's
          local database, so anyone with the device can read them back.
        */}
        <p className="border-border text-muted border-l-2 py-0.5 pl-3 text-xs">
          <strong className="text-fg font-semibold">Don&apos;t paste anything private.</strong> Your
          text, and every keystroke you type against it, are saved to this browser&apos;s local
          database so your results survive a reload. Nothing is uploaded anywhere, but anyone who
          can use this device or browser profile can read it — clear it with{' '}
          <span className="whitespace-nowrap">&ldquo;Clear all my data&rdquo;</span> below. You are
          responsible for what you paste; this trainer is provided as-is, with no warranty.
        </p>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="Paste a quote — a newspaper paragraph, anything in Khmer."
          aria-label="Your own text to type"
          lang="km"
          className="font-khmer border-border bg-surface text-fg focus-visible:border-caret block w-full rounded-md border p-3 text-base outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          {/*
            Three different jobs, three different weights. "Use this text" is
            the commit, so it is the solid one. "Clear text" only empties the
            box you are editing — red because it throws away something you
            pasted, but it does NOT change what you are currently typing
            against. "Use the built-in passages" is the one that does that,
            and it only exists while your own text is actually in use.
          */}
          <button
            onClick={() => onQuoteChange(draft.trim().length > 0 ? draft : null)}
            disabled={draft.trim().length === 0}
            className="bg-fg text-bg focus-visible:ring-caret cursor-pointer rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          >
            Use this text
          </button>

          <button
            onClick={() => setDraft('')}
            disabled={draft.length === 0}
            title="Empty the box above. Does not change what you are typing now."
            className="border-error/50 text-error hover:bg-error/10 hover:border-error focus-visible:ring-error cursor-pointer rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          >
            Clear text
          </button>

          {quote !== null && (
            <button
              onClick={() => onQuoteChange(null)}
              className="text-muted hover:text-fg focus-visible:ring-caret cursor-pointer rounded-lg px-2 py-1.5 text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              Use the built-in passages
            </button>
          )}
          {parsed && (
            // Never let a silent strip go unreported: the passage differs from
            // what was pasted, and the user is entitled to know why.
            <span className="text-muted text-xs">
              {parsed.words.length} words
              {parsed.removed > 0 && ` · ${parsed.removed} characters NiDA cannot type removed`}
              {parsed.truncated && ` · truncated to ${MAX_QUOTE_WORDS} words`}
            </span>
          )}
        </div>
      </div>
    </details>
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
  pausedMs,
  paused,
  caret,
  totalCps,
  quoteMode,
}: {
  phase: Phase;
  config: TestConfig;
  correctCp: number;
  correctPresses: number;
  totalPresses: number;
  startedAt: number;
  endedAt: number;
  pausedMs: number;
  paused: boolean;
  caret: number;
  totalCps: number;
  /** A quote ends when it runs out, so there is no countdown to display. */
  quoteMode: boolean;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // Stop ticking while paused so the displayed cpm/time freeze instead of
  // drifting down as if the user were typing nothing for tens of seconds.
  useEffect(() => {
    if (phase !== 'running' || paused) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, paused]);

  const ms =
    phase === 'idle' ? 0 : elapsedMs({ startedAt, endedAt: endedAt || performance.now(), pausedMs });
  const live = score({ correctCp, correctClusters: 0, correctPresses, totalPresses, ms });

  const progress = paused
    ? 'paused'
    : config.kind === 'time' && !quoteMode
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
  final,
  stats,
  saveState,
  onRestart,
}: {
  final: Score;
  stats: Stats;
  saveState?: { kind: 'saving' | 'saved' | 'error'; message?: string };
  onRestart: () => void;
}) {
  return (
    <div className="card space-y-4 p-6">
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

      <div className="flex flex-wrap items-center gap-4">
        {/*
          R5: this panel mounts below the passage and, on a wide screen, below
          the keyboard diagram — i.e. off the bottom of the window, which is
          why a finished run could go unnoticed. Taking focus scrolls it into
          view, pulls focus out of the input that is no longer recording, and
          puts Enter on "go again". Only ever on mount, and only for a run the
          user just finished themselves.
        */}
        <button
          autoFocus
          onClick={onRestart}
          className="bg-caret/15 text-caret hover:bg-caret/25 focus-visible:ring-caret cursor-pointer rounded-md px-4 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          Go again
        </button>

        {saveState?.kind === 'saving' && <span className="text-muted text-xs">Saving…</span>}
        {saveState?.kind === 'saved' && (
          <span className="text-muted text-xs">Saved to your local database.</span>
        )}
        {saveState?.kind === 'error' && (
          <span className="text-error text-xs">Not saved: {saveState.message}</span>
        )}
      </div>
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
