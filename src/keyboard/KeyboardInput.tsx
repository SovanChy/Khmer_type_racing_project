import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { resolveKey, type KeyAction } from './nida';

interface Props {
  onAction: (action: KeyAction) => void;
  children?: ReactNode;
}

/**
 * The typing surface: a visually hidden but focusable `<input>`.
 *
 * Not `contentEditable` — we need raw key events to run the remap, and a real
 * input is what raises the soft keyboard on mobile. The element stays empty;
 * the typed buffer is owned by the caller, never by the DOM.
 */
export function KeyboardInput({ onAction, children }: Props) {
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
      className={`rounded-lg border p-6 transition-colors ${
        focused ? 'border-sky-500 bg-neutral-900' : 'border-neutral-800 bg-neutral-900/50'
      }`}
    >
      <input
        ref={input}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole page is this field
        autoFocus
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Typing area"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="sr-only"
      />
      {children}
      {!focused && (
        <p className="mt-4 text-sm text-neutral-500">Click here, or Tab to it, to start typing.</p>
      )}
    </div>
  );
}
