import { standalone } from '../khmer/segment';
import {
  isModifier,
  keyFor,
  MODIFIER_LABEL,
  NIDA_LAYOUT,
  ROWS,
  type Layer,
} from './layout';
import { NIDA } from './nida';

/** How many upcoming keystrokes the strip shows. Enough to see the rest of a
 *  cluster and the space after it without becoming a second passage. */
export const HINT_KEYS = 5;

interface Props {
  /** Target codepoints still to type, next one first. Drawn as the key strip. */
  nextCps: readonly string[];
  /**
   * The codepoint the last keypress should have produced but didn't, or null.
   *
   * Drawn as a red card at the head of the strip, so the strip both hints the
   * next key AND reports the mistake — the two facts a learner needs at once.
   * Deliberately never reaches the keyboard diagram: a red key there would
   * compete with the green one for "which key do I press now".
   */
  missedCp: string | null;
}

/**
 * The one place that decides how a key cell looks: the target key renders
 * green, and nothing else is ever coloured.
 *
 * There is deliberately no red "you pressed this by mistake" state on the
 * DIAGRAM. Mistakes are reported by the card strip above it instead. Lighting
 * a red key here at the same time as the green next key puts two competing
 * answers on one picture, and it reads as an instruction to press the red
 * one. `isModifier` is its own branch, not a
 * variant of `mapped`: a modifier is never "unmapped" (it has no Khmer glyph
 * to map at all), so it gets a neutral dim style rather than the dimmer
 * "table has a gap here" style.
 */
function cellClass({
  isTarget,
  mapped,
  isModifier,
}: {
  isTarget: boolean;
  mapped: boolean;
  isModifier: boolean;
}): string {
  // ring-inset, not a wider border: a heavier border would change the box's
  // content area and jitter every other cell in the row when a key becomes
  // (or stops being) the target. A ring is a second, non-colour-only cue
  // layered on top — geometry, not just hue — that costs no layout.
  // The ring is a darker shade of the fill, not the same hue: on a cap that is
  // already solid colour, a same-colour ring would carry no geometry at all.
  if (isTarget)
    return 'border-highlight bg-highlight text-highlight-fg ring-2 ring-inset ring-highlight-fg/30';
  if (isModifier) return 'border-transparent bg-key/60 text-muted';
  // Dimmed, not hidden: the physical letter is still worth reading even where
  // the table maps nothing. Deliberately mild -- an unverified table dims the
  // whole diagram too, and the two stack.
  if (!mapped) return 'border-transparent bg-key/60 text-muted opacity-60';
  return 'border-transparent bg-key text-fg';
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

/**
 * What one strip card says under its glyph. The modifier belongs ON the card,
 * not in a card of its own: ⇧K is a single keystroke, and splitting it across
 * two cards would read as two presses.
 */
function keyLabel(code: string, layer: Layer): string {
  if (layer === 'shift') return `⇧${labelFor(code)}`;
  // Spelled out rather than ⌥, which means Option on a Mac and nothing on a PC.
  if (layer === 'altgr') return `AltGr ${labelFor(code)}`;
  return labelFor(code);
}

/** Spoken form of the same thing, for the screen-reader line. */
function keySentence(code: string, layer: Layer): string {
  const modifier = layer === 'shift' ? 'Shift + ' : layer === 'altgr' ? 'AltGr + ' : '';
  return `Press ${modifier}${labelFor(code)}`;
}

/**
 * Sibling of the passage, never its parent or a `<Word>` prop -- it reads
 * `caret`-derived values the same way `<TypingTest>` already does, but is not
 * in the render path of any `<Word>`, so a keypress still re-renders exactly
 * one of those.
 */
export function KeyboardHint({ nextCps, missedCp }: Props) {
  // Always the NiDA table, in both input modes. This used to diagram a layout
  // discovered from the user's own keystrokes when in OS mode, which meant the
  // board started blank and filled in one key per press -- useless for the one
  // thing a hint exists to do, which is tell you where a key is BEFORE you
  // have found it. OS mode assumes the user installed NiDA, so nida.json is
  // what their keyboard does anyway.
  const source = NIDA_LAYOUT;

  const nextCp = nextCps[0] ?? null;

  // Which key to highlight. No `layer` variable anymore -- see the diagram
  // comment below for why the old layer-flip is gone; every layer of every
  // key now renders at once, so there is nothing left to flip.
  const target = nextCp !== null ? keyFor(nextCp, source) : null;

  // Applies in both modes now that both diagram the same table.
  const unverified = !NIDA.verified;

  return (
    <div
      role="group"
      aria-label="Keyboard hint — NiDA layout"
      className="card space-y-4 p-4"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-muted text-xs font-semibold tracking-widest uppercase">Hint</span>
        <span className="text-muted text-xs">NiDA layout</span>
      </div>

      {/*
        The key SEQUENCE, not just the next key: a Khmer cluster is several
        keystrokes, and showing only the first one hid that the vowel and the
        subscript are separate presses. Each card is one keystroke, the
        immediate one lit.
      */}
      <div aria-hidden className="flex min-h-16 flex-wrap items-center gap-2">
        {missedCp !== null && (
          <KeyCard cp={missedCp} where={keyFor(missedCp, source)} state="missed" />
        )}
        {nextCps.map((cp, i) => (
          <KeyCard key={i} cp={cp} where={keyFor(cp, source)} state={i === 0 ? 'next' : 'ahead'} />
        ))}
      </div>

      {/*
        The strip above is a picture; this is the same fact in words. Not a
        live region on purpose -- announcing every keystroke would talk over
        the user rather than help them.
      */}
      <p className="sr-only">{target ? keySentence(target.code, target.layer) : ''}</p>

      {unverified && (
        <p className="text-muted text-xs">
          These positions were read from the Khmer (NIDA) layout installed on this machine, and
          have not been checked against the official layout by a human yet.
        </p>
      )}

      {/*
        overflow-x-auto on this wrapper, not the card: the widest row (13
        normal keys, ~776px) does not fit a narrow viewport, and this is the
        one element allowed to grow past it -- the page body itself must
        never gain a horizontal scrollbar because of this panel.

        Scaled down only in the band where the diagram shares the row with the
        passage and the row is not wide enough for both at full size: 776px of
        keys beside a 24rem passage column needs 1266px of viewport, which is
        14px under `xl`. Full size returns at 2xl, where there is room again.
        0.9 is the floor for legibility -- the caps carry a 9px key-code label,
        and below about this the label stops being readable at arm's length.

        `zoom` rather than `transform: scale`, because zoom reflows: the grid
        track shrinks with the diagram instead of leaving a hole where the
        unscaled box used to be. The rows are aria-hidden and nothing in here
        is clickable, so scaling costs no hit target and no screen reader text.
        Firefox before 126 ignores it and simply gets the old full-size panel.
      */}
      <div className="overflow-x-auto wide:[zoom:0.9] 2xl:[zoom:1]">
        <div
          className={`flex w-fit flex-col gap-1 font-mono text-xs ${unverified ? 'opacity-70' : ''}`}
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
                    <SpaceKey key={code} isTarget={target?.code === 'Space'} />
                  );
                }
                return (
                  <LetterKey
                    key={code}
                    code={code}
                    mapping={source[code]}
                    isTarget={target?.code === code}
                    // Which glyph ON this cap is the target — a cap shows every
                    // layer, so lighting the whole cap green does not say
                    // whether the base or the shift character is meant.
                    aim={target?.code === code ? target.layer : null}
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

/** U+2423 OPEN BOX. The space bar types a character with no glyph of its own. */
const SPACE_GLYPH = '␣';

/**
 * One upcoming keystroke: the character it produces, over the physical key
 * that produces it. Unknown keys still get a card — in OS mode the layout is
 * learned as you type, and hiding the character until the key is known would
 * leave a gap exactly where the user needs to be told something.
 */
type CardState =
  /** Already typed, and typed wrong. Sits behind the caret, at the strip head. */
  | 'missed'
  /** The very next keystroke. */
  | 'next'
  /** Further down the queue. */
  | 'ahead';

const CARD_CLASS: Record<CardState, string> = {
  // The strike-through is the non-colour cue: red alone would vanish under
  // red/green colour blindness, and this card is the only error report left
  // now that the separate correct/incorrect strip is gone.
  missed: 'border-error bg-error/15 text-error',
  next: 'border-highlight bg-highlight text-highlight-fg ring-1 ring-highlight-fg/30',
  ahead: 'border-transparent bg-key text-muted',
};

function KeyCard({
  cp,
  where,
  state,
}: {
  cp: string;
  where: { code: string; layer: Layer } | null;
  state: CardState;
}) {
  return (
    <div
      className={`flex h-16 min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border px-2 ${CARD_CLASS[state]}`}
    >
      {/* Struck through only on the GLYPH: the key label below is what the
          user still has to press, so striking that too would read as "do not
          press this". The strike is the non-colour cue for the missed state —
          red alone disappears under red/green colour blindness. */}
      <span
        className={`font-khmer text-2xl leading-[1.3] ${state === 'missed' ? 'line-through decoration-2' : ''}`}
        lang="km"
      >
        {cp === ' ' ? SPACE_GLYPH : standalone(cp)}
      </span>
      <span className="font-mono text-[10px] leading-none tracking-wide uppercase">
        {where ? keyLabel(where.code, where.layer) : '?'}
      </span>
    </div>
  );
}

/**
 * A normal typing key, drawn like a real keycap: the physical Latin label in
 * the dim top-left corner (the least important thing on the cap now), the
 * shift character small on the upper line, and the base glyph large below it.
 * That stack is the point — the shift layer is a legend you can read at rest,
 * not something that only appears once you happen to be aiming at it, which is
 * what the old whole-diagram layer flip required.
 */
function LetterKey({
  code,
  mapping,
  isTarget,
  aim,
}: {
  code: string;
  mapping: Partial<Record<Layer, string>> | undefined;
  isTarget: boolean;
  aim: Layer | null;
}) {
  const base = mapping?.base ?? null;
  const shift = mapping?.shift ?? null;
  const altgr = mapping?.altgr ?? null;

  // The target layer inherits the cap's green; every other layer stays a dim
  // legend. With no target on this cap the base glyph is its main character —
  // the ordinary resting look.
  const glyphClass = (layer: Layer) =>
    aim === layer || (aim === null && layer === 'base') ? '' : 'text-muted';

  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`relative flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded border ${cellClass({ isTarget, mapped: base !== null, isModifier: false })}`}
    >
      <span className="text-muted absolute top-0.5 left-1 text-[9px] leading-none">
        {labelFor(code)}
      </span>
      {/*
        Fixed height whether or not this key has a shift layer, so every cap's
        base glyph sits on the same line right across the diagram. The glyph
        is 13px, not smaller: below about 11px a Khmer diacritic stops being
        identifiable at all, and a legend too small to read is just noise.
      */}
      <span
        className={`font-khmer flex h-4 items-center text-[13px] leading-none ${glyphClass('shift')}`}
        lang="km"
      >
        {shift && standalone(shift)}
      </span>
      {base && (
        <span className={`font-khmer text-xl leading-[1.3] ${glyphClass('base')}`} lang="km">
          {standalone(base)}
        </span>
      )}
      {altgr && (
        <span
          className={`font-khmer absolute right-1 bottom-0.5 text-[11px] leading-none ${glyphClass('altgr')}`}
          lang="km"
        >
          {standalone(altgr)}
        </span>
      )}
    </div>
  );
}

/**
 * ShiftLeft/ShiftRight/AltRight. Flexible width so the two half-width shift
 * keys and the narrower AltGr key stretch to fill out their row instead of
 * leaving it shorter than the row above. Never shows a Khmer glyph and can
 * never be a target in its own right -- `keyFor` never resolves a codepoint
 * to a modifier code (see `layout.ts`).
 */
function ModifierKey({ code, isTarget }: { code: string; isTarget: boolean }) {
  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`flex h-16 flex-1 items-center justify-center rounded border text-xs ${cellClass({ isTarget, mapped: false, isModifier: true })}`}
    >
      {MODIFIER_LABEL[code]}
    </div>
  );
}

/**
 * The space bar. Flexible-width like a modifier so it fills its row, but it
 * is NOT a modifier (see `isModifier` in layout.ts) -- it is a real target
 * key, so it still takes `isTarget` like `LetterKey` does. Grows
 * more than `AltRight` (`flex-[6]` vs. `flex-1`) so it reads as the wide bar
 * it is on a real keyboard rather than an even split.
 */
function SpaceKey({ isTarget }: { isTarget: boolean }) {
  return (
    <div
      aria-current={isTarget ? 'true' : undefined}
      className={`flex h-16 flex-[6] items-center justify-center rounded border text-xs ${cellClass({ isTarget, mapped: true, isModifier: false })}`}
    >
      {MODIFIER_LABEL.Space}
    </div>
  );
}
