import { useState } from 'react';
import { KeyboardInput } from './keyboard/KeyboardInput';
import { NIDA, type InputMode, type KeyAction } from './keyboard/nida';
import { useStore } from './store';

const MODES: { value: InputMode; label: string; hint: string }[] = [
  { value: 'remap', label: 'In-app remap', hint: 'No install needed. Assumes a QWERTY keyboard.' },
  { value: 'os', label: 'OS layout', hint: 'You already have the system Khmer NiDA layout.' },
];

function ModeToggle() {
  const inputMode = useStore((s) => s.inputMode);
  const setInputMode = useStore((s) => s.setInputMode);

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-neutral-300">Input mode</legend>
      <div role="radiogroup" className="flex gap-2">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            role="radio"
            aria-checked={inputMode === value}
            onClick={() => setInputMode(value)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              inputMode === value
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {MODES.find((m) => m.value === inputMode)?.hint}
      </p>
    </fieldset>
  );
}

/** Formats a codepoint as U+XXXX — the only reliable way to read Khmer in a log. */
const u = (s: string) =>
  [...s].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

export function App() {
  const inputMode = useStore((s) => s.inputMode);
  // Phase 2 harness only. Phase 3 moves the typed buffer into a `useRef` so a
  // keypress re-renders one `<Word>` instead of the whole passage.
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<KeyAction | null>(null);

  function handleAction(action: KeyAction) {
    setLast(action);
    if (action.type === 'char') setTyped((t) => t + action.cp);
    if (action.type === 'backspace') setTyped((t) => [...t].slice(0, -1).join(''));
  }

  const unverified = inputMode === 'remap' && !NIDA.verified;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 bg-neutral-950 p-8 text-neutral-200">
      <header>
        <h1 className="text-lg font-semibold">Khmer NiDA Typing Trainer</h1>
        <p className="text-sm text-neutral-500">Phase 2 — keyboard input layer.</p>
      </header>

      <ModeToggle />

      {unverified && (
        <p
          role="alert"
          className="rounded-md border border-amber-600/50 bg-amber-500/10 p-3 text-sm text-amber-300"
        >
          <strong className="font-semibold">The NiDA layout table is not verified.</strong> Every
          mapping in <code>nida.json</code> is a placeholder, so remap mode currently produces
          nonsense. Do not practise on it — it would teach wrong muscle memory.
        </p>
      )}

      {inputMode === 'remap' && (
        <p className="text-xs text-neutral-500">
          Remap mode reads physical key position, which assumes a QWERTY keyboard. On AZERTY,
          Dvorak or Colemak hardware, switch to OS layout mode.
        </p>
      )}

      <KeyboardInput onAction={handleAction}>
        <p className="min-h-16 font-khmer text-3xl break-all">
          {typed || <span className="text-neutral-600">…</span>}
        </p>
      </KeyboardInput>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs text-neutral-500">
        <dt>last action</dt>
        <dd>{last ? last.type : '—'}</dd>
        <dt>codepoints</dt>
        <dd className="break-all">{typed ? u(typed) : '—'}</dd>
      </dl>
    </main>
  );
}
