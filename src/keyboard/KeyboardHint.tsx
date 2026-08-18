import type { ReactNode } from 'react';
import { isModifier, keyFor, MODIFIER_LABEL, NIDA_LAYOUT, ROWS, type Layer } from './layout';
import { NIDA } from './nida';
import { observedLayout } from './observed';
import { useStore } from '../store';

interface Props {
  nextCp: string | null;
  nextCluster: string | null;
  /** Codepoint the last keypress got wrong, or null. Drawn as the red key. */
  wrongCp: string | null;
}

/**
 * The one place that decides how a key cell looks. This IS the R2 colouring
 * (not a promise of it): the target key renders green, the key the last wrong
 * press actually produced renders red, and a normal/unmapped key falls back
 * to the two states that already existed. A key cannot be both — a correct
 * press is never "wrong" — but if it somehow were, `isTarget` wins and no
 * extra UI is added for that case. `isModifier` is its own branch, not a
 * variant of `mapped`: a modifier is never "unmapped" (it has no Khmer glyph
 * to map at all), so it gets a neutral dim style rather than the dimmer
 * "table has a gap here" style.
 */
function cellClass({
  isTarget,
  isWrong,
  mapped,
  isModifier,
}: {
  isTarget: boolean;
  isWrong: boolean;
  mapped: boolean;
  isModifier: boolean;
}): string {
  // ring-inset, not a wider border: a heavier border would change the box's
  // content area and jitter every other cell in the row when a key becomes
  // (or stops being) the target. A ring is a second, non-colour-only cue
  // layered on top — geometry, not just hue — that costs no layout.
  if (isTarget) return 'border-caret bg-caret/15 text-caret ring-2 ring-inset ring-caret';
  if (isWrong) return 'border-error bg-error/15 text-error';
  if (isModifier) return 'border-border text-muted';
  // Dimmed, not hidden: the physical letter is still worth reading even where
  // the table maps nothing. Deliberately mild -- an unverified table dims the
  // whole diagram too, and the two stack.
  if (!mapped) return 'border-border text-muted opacity-60';
  return 'border-border text-fg';
}

/**
 * Short label for a physical key, derived from its `KeyboardEvent.code`
 * rather than hand-listed -- letters and digits fall out of the code's own
 * shape, only the punctuation keys need a lookup at all.
 */
const SYMBOL_LABEL: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

function labelFor(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return SYMBOL_LABEL[code] ?? code;
}

// Below this many known keys, the observed layout hasn't learned enough to
// mean anything yet -- ponytail: a picked-not-measured floor. Tune it (or
// replace with a real signal) if the "still learning" message fires too
// eagerly or lingers too long against real usage.
const MIN_OBSERVED_KEYS = 5;

/**
 * Sibling of the passage, never its parent or a `<Word>` prop -- it reads
 * `caret`-derived values the same way `<TypingTest>` already does, but is not
 * in the render path of any `<Word>`, so a keypress still re-renders exactly
 * one of those.
 */
export function KeyboardHint({ nextCp, nextCluster, wrongCp }: Props) {
  const inputMode = useStore((s) => s.inputMode);
  // Read only to force a re-render when OS mode learns a NEW key; the value
  // itself is unused -- observedLayout() below is the actual source of truth.
  useStore((s) => s.layoutLearned);

  // remap mode -> nida.json, which IS what the app produces (placeholder or
  // not). OS mode -> the user's real keyboard, discovered at runtime: the app
  // never consults nida.json to resolve a keypress in that mode, so showing
  // it there would diagram something unrelated to what actually happens.
  const source = inputMode === 'os' ? observedLayout() : NIDA_LAYOUT;

  // Which key to highlight. No `layer` variable anymore -- see the diagram
  // comment below for why the old layer-flip is gone; every layer of every
  // key now renders at once, so there is nothing left to flip.
  const target = nextCp !== null ? keyFor(nextCp, source) : null;

  // R2: the key that actually produced the last wrong press, resolved the
  // same way as the target -- same source table, same reverse lookup.
  const wrong = wrongCp !== null ? keyFor(wrongCp, source) : null;

  // Which modifier cell (if any) lights up alongside the target letter.
  // `keyFor` never returns a modifier as `target.code` itself (see the
  // comment on `keyFor`), so this is the only place a modifier becomes "the
  // target" -- problem 3 from the redesign brief.
  const modifierForTarget: 'ShiftLeft' | 'AltRight' | null =
    target?.layer === 'shift' ? 'ShiftLeft' : target?.layer === 'altgr' ? 'AltRight' : null;

  const remapUnverified = inputMode === 'remap' && !NIDA.verified;
  // OS mode has no "verified" flag -- it's the user's own keyboard -- but a
  // near-empty observed layout is just as unhelpful, so the same "don't trust
  // this yet" signal applies once there isn't enough data to answer with.
  const stillLearning =
    inputMode === 'os' &&
    nextCp !== null &&
    (Object.keys(source).length < MIN_OBSERVED_KEYS || target === null);

  return (
    <div
      role="group"
      aria-label={inputMode === 'os' ? 'Keyboard hint — your keyboard' : 'Keyboard hint — NiDA layout'}
      className="border-border bg-surface space-y-4 rounded-lg border p-4"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-muted text-xs font-semibold tracking-widest uppercase">Hint</span>
        <span className="text-muted text-xs">
          {inputMode === 'os' ? 'your keyboard' : 'NiDA layout'}
        </span>
      </div>

      {/*
        The focal point of the panel: the next cluster, huge, beside its
        instruction rather than above it. Vertical space is tight -- the
        passage above is a fixed 3-line window precisely to keep this panel
        on screen -- so this stays a row from `sm:` up and only stacks on
        narrow viewports.
      */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="border-border shrink-0 rounded-lg border p-6 sm:p-8">
          {nextCluster !== null ? (
            <span className="font-khmer text-6xl leading-[1.3] sm:text-7xl" lang="km">
              {nextCluster}
            </span>
          ) : (
            // Same size as the real glyph so nothing reflows when a run ends.
            <span className="text-muted text-6xl leading-[1.3] sm:text-7xl">—</span>
          )}
        </div>

        <div className="text-lg sm:text-xl">
          {stillLearning ? (
            <p className="text-muted">Learning your keyboard — keys fill in as you type.</p>
          ) : target ? (
            <p>
              {modifierForTarget && (
                <>
                  Hold <Keycap>{MODIFIER_LABEL[modifierForTarget]}</Keycap>{' '}
                </>
              )}
              Press <Keycap>{labelFor(target.code)}</Keycap>
            </p>
          ) : null}
        </div>
      </div>

      {remapUnverified && (
        <p className="text-muted text-xs">
          The layout table is a placeholder, so the key positions below are not the real NiDA
          layout.
        </p>
      )}

      {/*
        overflow-x-auto on this wrapper, not the card: the widest row (13
        normal keys, ~776px) does not fit a narrow viewport, and this is the
        one element allowed to grow past it -- the page body itself must
        never gain a horizontal scrollbar because of this panel.
      */}
      <div className="overflow-x-auto">
        <div
          className={`flex w-fit flex-col gap-1 font-mono text-xs ${remapUnverified ? 'opacity-70' : ''}`}
        >
          {ROWS.map((row, i) => (
            <div key={i} className="flex w-full gap-1">
              {row.map((code) => {
                if (isModifier(code)) {
                  const isTarget =
                    code === 'AltRight' ? target?.layer === 'altgr' : target?.layer === 'shift';
                  return <ModifierKey key={code} code={code} isTarget={isTarget} />;
                }
                if (code === 'Space') {
                  return (
                    <SpaceKey
                      key={code}
                      isTarget={target?.code === 'Space'}
                      isWrong={wrong?.code === 'Space'}
                    />
                  );
                }
                return (
                  <LetterKey
                    key={code}
                    code={code}
                    mapping={source[code]}
                    isTarget={target?.code === code}
                    isWrong={wrong?.code === code}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small keycap-styled inline element so a key name reads as a key, not a word. */
function Keycap({ children }: { children: ReactNode }) {
  return (
    <span className="border-border rounded border px-2 py-0.5 font-mono text-base">
      {children}
    </span>
  );
}

/**
 * A normal typing key, drawn like a real keycap: the physical Latin label in
 * the dim top-left corner (the least important thing on the cap now), the
 * base glyph large and centred, and the shift/altgr glyphs small in their own
 * corners -- omitted where the table has no mapping. This is what replaces
 * the old whole-diagram layer flip: every layer of every key is visible at
 * once, so the shift character is always readable, not only when it happens
 * to be the target.
 */
function LetterKey({
  code,
  mapping,
  isTarget,
  isWrong,
}: {
  code: string;
  mapping: Partial<Record<Layer, string>> | undefined;
  isTarget: boolean;
  isWrong: boolean;
}) {
  const base = mapping?.base ?? null;
  const shift = mapping?.shift ?? null;
  const altgr = mapping?.altgr ?? null;
  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded border ${cellClass({ isTarget, isWrong, mapped: base !== null, isModifier: false })}`}
    >
      {/*
        Corner legends sit at text-[11px], not smaller. Below about 11px the
        Khmer shift/altgr glyphs stop being identifiable at all — the point of
        showing every layer at once is that they can be READ without targeting
        the key, and a legend too small to read is just noise on the cap.
      */}
      <span className="text-muted absolute top-0.5 left-1 text-[11px] leading-none">
        {labelFor(code)}
      </span>
      {shift && (
        <span
          className="font-khmer text-muted absolute top-0.5 right-1 text-[11px] leading-none"
          lang="km"
        >
          {shift}
        </span>
      )}
      {altgr && (
        <span
          className="font-khmer text-muted absolute right-1 bottom-0.5 text-[11px] leading-none"
          lang="km"
        >
          {altgr}
        </span>
      )}
      {base && (
        <span className="font-khmer text-xl" lang="km">
          {base}
        </span>
      )}
    </div>
  );
}

/**
 * ShiftLeft/ShiftRight/AltRight. Flexible width so the two half-width shift
 * keys and the narrower AltGr key stretch to fill out their row instead of
 * leaving it shorter than the row above. Never shows a Khmer glyph and can
 * never be the R2 wrong-key match -- `keyFor` never resolves a codepoint to a
 * modifier code (see `layout.ts`), so `isWrong` is not even a prop here.
 */
function ModifierKey({ code, isTarget }: { code: string; isTarget: boolean }) {
  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`flex h-14 flex-1 items-center justify-center rounded border text-xs ${cellClass({ isTarget, isWrong: false, mapped: false, isModifier: true })}`}
    >
      {MODIFIER_LABEL[code]}
    </div>
  );
}

/**
 * The space bar. Flexible-width like a modifier so it fills its row, but it
 * is NOT a modifier (see `isModifier` in layout.ts) -- it is a real target
 * key, so it still takes `isTarget`/`isWrong` like `LetterKey` does. Grows
 * more than `AltRight` (`flex-[6]` vs. `flex-1`) so it reads as the wide bar
 * it is on a real keyboard rather than an even split.
 */
function SpaceKey({ isTarget, isWrong }: { isTarget: boolean; isWrong: boolean }) {
  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`flex h-14 flex-[6] items-center justify-center rounded border text-xs ${cellClass({ isTarget, isWrong, mapped: true, isModifier: false })}`}
    >
      {MODIFIER_LABEL.Space}
    </div>
  );
}
