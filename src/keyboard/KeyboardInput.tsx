import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { resolveKey, type KeyAction } from './nida';

interface Props {
  onAction: (action: KeyAction) => void;
  /** True while a running test is paused because this input lost focus. */
  paused?: boolean;
  /**
   * Why the run is over, or null while it is still live. R5: the input has to
   * say this itself. A finished run used to look exactly like a running one —
   * same ring, same caret, still focused — so keystrokes went nowhere with no
   * indication that they were being dropped.
   */
  ended?: 'time' | 'passage' | null;
  /** Fires after the input loses focus — the caller uses this to pause a running test. */
  onBlur?: () => void;
  /** Fires after the input regains focus — the caller uses this to resume. */
  onFocus?: () => void;
  children?: ReactNode;
}

/**
 * The typing surface: a real, visible, click-to-focus `<input>`.
 *
 * Not `contentEditable` — we need raw key events to run the remap, and a real
 * input is what raises the soft keyboard on mobile. The element stays empty;
 * the typed buffer is owned by the caller, never by the DOM.
 *
 * Deliberately never autofocused: capture must start only when the user
 * clicks or tabs into it, and the field must be visible so they can see when
 * keystrokes are being recorded. See CLAUDE.md and SECURITY-REVIEW.md §10.
 */
export function KeyboardInput({
  onAction,
  paused = false,
  ended = null,
  onBlur,
  onFocus,
  children,
}: Props) {
  const inputMode = useStore((s) => s.inputMode);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Drop focus the moment the run ends. Keystrokes are ignored from here on,
  // and a field that still looks live while swallowing everything typed into
  // it is the whole complaint R5 is about.
  useEffect(() => {
    if (ended) input.current?.blur();
  }, [ended]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const action = resolveKey(e, inputMode);
    // Swallow only what we consume. Swallowing everything would trap keyboard
    // users, who need Tab and Escape to leave the field.
    if (action.type !== 'ignore') e.preventDefault();

    onAction(action);
    // Anything we let through would otherwise accumulate in the element.
    e.currentTarget.value = '';
  }

  return (
    // Focus is a ring, not a border: the panel is a shadowed card now, and a
    // colour-changing border would shift its content box by a pixel on every
    // focus and blur.
    <div
      onClick={() => input.current?.focus()}
      className={`card cursor-text p-6 ring-inset transition-shadow ${
        ended
          ? 'ring-highlight ring-2'
          : paused
            ? 'ring-caret/40 ring-2'
            : focused
              ? 'ring-caret ring-2'
              : 'ring-0'
      }`}
    >
      {children}

      <input
        ref={input}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        aria-label="Typing area"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Password managers see a lone empty text input and offer to fill it —
        // this stops 1Password/LastPass from injecting an overlay into it.
        data-1p-ignore
        data-lpignore="true"
        className={`mt-4 block h-14 w-full rounded-md border px-4 text-fg outline-none transition-colors ${
          focused ? 'border-caret' : 'border-border'
        }`}
      />

      {/*
        One `<p>` in one position across every branch, so a screen reader sees
        this live region change text rather than a region appearing — which is
        the difference between an announcement and silence.
      */}
      {ended ? (
        <p
          role="status"
          className="bg-highlight text-highlight-fg mt-2 rounded-md px-3 py-2 text-sm font-semibold"
        >
          {ended === 'time' ? "Time's up." : 'Passage finished.'} This run is over — keystrokes are
          no longer counted. Your result is below.
        </p>
      ) : paused ? (
        <p role="status" className="text-caret mt-2 flex items-center gap-2 text-sm font-medium">
          <span className="bg-caret h-2 w-2 rounded-full" aria-hidden />
          Paused — click here, or Tab to it, to resume.
        </p>
      ) : focused ? (
        <p role="status" className="text-caret mt-2 flex items-center gap-2 text-sm font-medium">
          <span className="bg-caret h-2 w-2 rounded-full motion-safe:animate-pulse" aria-hidden />
          Recording — keystrokes typed here are being captured.
        </p>
      ) : (
        <p role="status" className="text-muted mt-2 text-sm">Click here, or Tab to it, to start typing.</p>
      )}
    </div>
  );
}
