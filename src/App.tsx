import { useEffect } from 'react';
import { NIDA, type InputMode } from './keyboard/nida';
import { TypingTest } from './typing/TypingTest';
import { DataPanel } from './DataPanel';
import { initDatabase } from './storage';
import { useStore } from './store';

const MODES: { value: InputMode; label: string; hint: string }[] = [
  { value: 'remap', label: 'In-app remap', hint: 'Nothing to install. Assumes a QWERTY keyboard.' },
  { value: 'os', label: 'OS layout', hint: 'You already have the system Khmer NiDA layout.' },
];

const chip = (selected: boolean) =>
  `cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caret ${
    selected
      ? 'border-caret bg-caret/10 text-caret'
      : 'border-border text-muted hover:text-fg hover:border-fg/30'
  }`;

function ModeToggle() {
  const inputMode = useStore((s) => s.inputMode);
  const setInputMode = useStore((s) => s.setInputMode);

  return (
    <div role="radiogroup" aria-label="Input mode" className="flex gap-2">
      {MODES.map(({ value, label }) => (
        <button
          key={value}
          role="radio"
          aria-checked={inputMode === value}
          onClick={() => setInputMode(value)}
          className={chip(inputMode === value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      className={chip(false)}
    >
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}

export function App() {
  const inputMode = useStore((s) => s.inputMode);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Claim the database lock on load rather than on the first save, so a second
  // tab is told immediately instead of after a run it cannot store.
  useEffect(() => initDatabase(), []);

  const unverified = inputMode === 'remap' && !NIDA.verified;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl space-y-8 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Khmer NiDA Typing Trainer</h1>
          <p className="text-muted text-sm">
            {MODES.find((m) => m.value === inputMode)?.hint}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <ThemeToggle />
        </div>
      </header>

      {unverified && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <strong className="font-semibold">The NiDA layout table is not verified.</strong> Every
          mapping in <code>nida.json</code> is a placeholder, so remap mode produces nonsense. Do
          not practise on it — it would teach wrong muscle memory. Switch to OS layout mode to try
          the trainer meanwhile.
        </p>
      )}

      {inputMode === 'remap' && (
        <p className="text-muted text-xs">
          Remap mode reads physical key position, which assumes a QWERTY keyboard. On AZERTY,
          Dvorak or Colemak hardware, switch to OS layout mode.
        </p>
      )}

      <TypingTest />
      <DataPanel />
    </main>
  );
}
