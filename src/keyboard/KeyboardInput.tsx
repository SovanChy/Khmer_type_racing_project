import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { resolveKey, type KeyAction } from './nida';

interface Props {
  onAction: (action: KeyAction) => void;
  /** True while a running test is paused because this input lost focus. */
  paused?: boolean;
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
export function KeyboardInput({ onAction, paused = false, onBlur, onFocus, children }: Props) {
  const inputMode = useStore((s) => s.inputMode);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

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
    <div
      onClick={() => input.current?.focus()}
      className={`cursor-text rounded-lg border p-6 transition-colors ${
        paused
          ? 'border-caret/40 bg-surface'
          : focused
            ? 'border-caret bg-surface'
            : 'border-border bg-surface/50'
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

      {paused ? (
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
