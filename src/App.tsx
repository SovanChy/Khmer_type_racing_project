import { useEffect, useState } from 'react';
import { NIDA, type InputMode } from './keyboard/nida';
import { TypingTest } from './typing/TypingTest';
import { Analytics } from './Analytics';
import { DataPanel } from './DataPanel';
import { initDatabase } from './storage';
import { useStore } from './store';

const MODES: { value: InputMode; label: string; hint: string }[] = [
  { value: 'remap', label: 'In-app remap', hint: 'Nothing to install. Assumes a QWERTY keyboard.' },
  { value: 'os', label: 'OS layout', hint: 'You already have the system Khmer NiDA layout.' },
];

const chip = (selected: boolean) =>
  `cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caret ${
    selected
      ? 'border-caret bg-caret text-bg font-semibold'
      : 'border-border bg-surface text-muted hover:text-fg hover:border-fg/30'
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

/**
 * Two views, not two routes. There is no router in this project and adding one
 * to switch between two panels would cost more than it saves; the URL is not
 * worth a dependency here.
 */
const PAGES = ['Practice', 'Statistics'] as const;
type Page = (typeof PAGES)[number];

function Nav({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  return (
    <nav aria-label="Sections" className="flex gap-1">
      {PAGES.map((p) => (
        <button
          key={p}
          aria-current={page === p ? 'page' : undefined}
          onClick={() => onChange(p)}
          className={`focus-visible:ring-caret cursor-pointer rounded-md px-3 py-1.5 text-base transition-colors focus-visible:ring-2 focus-visible:outline-none ${
            page === p
              ? 'text-caret border-caret border-b-2 font-semibold'
              : 'text-muted hover:text-fg border-b-2 border-transparent'
          }`}
        >
          {p}
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const inputMode = useStore((s) => s.inputMode);
  const theme = useStore((s) => s.theme);
  const [page, setPage] = useState<Page>('Practice');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Claim the database lock on load rather than on the first save, so a second
  // tab is told immediately instead of after a run it cannot store.
  useEffect(() => initDatabase(), []);

  // Both modes now diagram nida.json, so the caveat is no longer remap-only.
  const unverified = !NIDA.verified;

  return (
    // Wider only at `wide`, where TypingTest splits the passage and the
    // keyboard into two columns — 4xl cannot hold both. Everything narrower
    // keeps the old reading width. Both must switch at the same breakpoint: a
    // two-column grid inside a 4xl shell has nowhere to put the second column.
    <main className="mx-auto min-h-dvh max-w-4xl space-y-6 px-6 py-8 wide:max-w-[92rem]">
      <header className="card flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <h1 className="text-caret text-xl font-bold">Khmer NiDA Typing Trainer</h1>
          <p className="text-muted text-sm">
            {MODES.find((m) => m.value === inputMode)?.hint}
          </p>
        </div>
        <Nav page={page} onChange={setPage} />
        <div className="flex items-center gap-2">
          <ModeToggle />
          <ThemeToggle />
        </div>
      </header>

      {unverified && (
        <p
          role="alert"
          className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <strong className="font-semibold">The NiDA layout table is not verified.</strong>{' '}
          <code>nida.json</code> was read from the Khmer (NIDA) layout installed on this machine,
          not hand-written — but no human has checked it against the official layout yet. Spot-check
          the keys below before you practise on it.
        </p>
      )}

      {/*
        Hidden, not unmounted. Unmounting made the swap flash: <Analytics>
        re-ran its worker queries on every visit and rendered nothing until
        they came back, and a half-finished practice run was thrown away for
        the price of a glance at the charts. Blurring the typing input already
        pauses that run, so leaving it mounted costs nothing.
      */}
      <div className={page === 'Practice' ? 'fade-in space-y-6' : 'hidden'}>
        {inputMode === 'remap' && (
          <p className="text-muted text-xs">
            Remap mode reads physical key position, which assumes a QWERTY keyboard. On AZERTY,
            Dvorak or Colemak hardware, switch to OS layout mode.
          </p>
        )}
        <TypingTest />
      </div>
      <div className={page === 'Statistics' ? 'fade-in space-y-6' : 'hidden'}>
        <Analytics />
        <DataPanel />
      </div>

      {/*
        Says what the app does with what you type, in the one place a person
        looks for it. Deliberately states the mechanism ("stays in this
        browser") rather than only a disclaimer — the mechanism is the part
        that is actually true and actually protective.
      */}
      <footer className="border-border text-muted space-y-1 border-t pt-6 text-xs">
        <p>
          No accounts, no analytics, no telemetry. Everything you type, paste and store stays in
          this browser — use &ldquo;Clear all my data&rdquo; on the Statistics page to delete it.
          Whoever hosts this page keeps ordinary web-server access logs, which contain none of it.
        </p>
        <p>
          Please don&apos;t enter private, confidential or otherwise sensitive text. Anything you
          enter is at your own risk and remains your responsibility. This trainer is provided
          as-is, without warranty of any kind and with no liability for how it is used.
        </p>
        <p>© 2026 SovanChy. Free to use, not to sell.</p>
      </footer>
    </main>
  );
}
