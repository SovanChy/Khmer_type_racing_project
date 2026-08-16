# Build Spec: Khmer NiDA Typing Trainer

Build a MonkeyType-style typing trainer for the Khmer **NiDA** keyboard layout.
Static site, no backend, deployable free to Netlify, runs identically on localhost.

Work through the phases in order. After each phase, stop and tell me what you
built and how to verify it. Do not skip ahead to UI polish.

---

## Stack (fixed — do not substitute)

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS
- Zustand for shared state (with selector subscriptions — **not** React Context)
- SQLite in-browser: `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS, in a Web Worker
- `vite-plugin-pwa` for offline support
- Vitest for unit tests
- Font: `@fontsource-variable/noto-sans-khmer`, self-hosted and bundled.
  Never rely on the user's system Khmer font — rendering varies wildly by device.
- Build output: static `dist/`, no serverless functions, no env vars, no auth

---

## Phase 1 — Khmer cluster engine (no UI, tests first)

This is the foundation. Get it right before anything renders.

**Do NOT use `Intl.Segmenter` for grapheme clusters.** It follows UAX #29, which
splits coeng (subscript) sequences: `ក្ក` comes out as two clusters instead of
one. Implement segmentation directly:

```ts
const BASE  = '[\u1780-\u17A2\u17A5-\u17B3]';   // consonants + independent vowels
const COENG = `(?:\u17D2${BASE})`;               // ្ + subscript consonant
const SIGN  = '[\u17B6-\u17D1\u17D3\u17DD]';     // dependent vowels + diacritics
const CLUSTER = new RegExp(`${BASE}${COENG}*${SIGN}*|.`, 'gu');
```

Deliver in `src/khmer/`:

- `segment(text: string): string[]` — split into clusters
- `stripInvisible(text: string): string` — remove `U+200B` (zero-width space).
  Properly-encoded Khmer uses ZWSP for word boundaries; users can't see it and
  won't type it. Strip it at corpus-load time.
- `compare(target: string, typed: string): CharState[]` — see below

**Critical distinction, get this exactly right:**
- **Compare at the codepoint level.** One NiDA keypress emits exactly one
  codepoint, so per-keystroke correctness is judged against the target's
  codepoint sequence.
- **Render and place the caret at the cluster level.** If the caret lands inside
  a stacked glyph, the display breaks visually.

So `compare` returns per-codepoint states, plus a mapping from codepoint index →
cluster index for the renderer to consume.

**Vitest cases required before moving on:** plain consonants; a coeng stack
(`ក្ក`); base + coeng + vowel (`ស្រ` + `ី`); a cluster typed correctly but in
the wrong codepoint order; text containing ZWSP; mixed Khmer/Latin/digits;
empty and single-codepoint input.

---

## Phase 2 — Keyboard input layer

Two modes, user-toggleable, persisted:

1. **OS layout mode** — user has the system Khmer NiDA layout installed. Read
   `event.key` directly.
2. **In-app remap mode** (default) — works on any machine with no install.
   Read `event.code` (physical key position, layout-independent),
   `preventDefault()`, and map through our own NiDA table.

Store the table as JSON: ~50 keys × three layers (base / shift / AltGr).

> **STOP before writing the table.** Do not generate the NiDA mappings from
> memory — an incorrect layout silently teaches wrong muscle memory, which is
> worse than no app. Scaffold the file with the correct *shape*, a handful of
> keys filled in as examples, and a `TODO` marker. I will supply the verified
> table from the official NiDA layout. Then write a validation test that asserts
> every entry is a valid Khmer codepoint and that no codepoint is mapped twice.

Note in the UI that `event.code` mapping assumes a QWERTY physical keyboard;
AZERTY/Dvorak users should switch to OS layout mode.

Input surface: a **hidden `<input>`** with `onKeyDown` + `preventDefault()`.
Not `contentEditable` — we need raw key events for the remap, and a real input
keeps mobile keyboards working.

---

## Phase 3 — Typing UI

The hard requirement: **one keypress must not re-render the whole passage.**

- Keep the full typed buffer in a `useRef`, not state.
- On each keydown, mutate the ref, then set exactly one small piece of state:
  active word index + that word's typed string.
- Render the passage as `<Word>` components wrapped in `React.memo`, keyed by
  index, each receiving only its own target text and a
  `status: 'done' | 'active' | 'pending'` prop. Completed and pending words then
  get identical props across keystrokes and bail out of re-rendering.
- Only the active word re-renders per keystroke.

Include a dev-mode render counter so I can confirm this actually holds.

UI surface: timed (15/30/60s) and word-count (25/50/100) modes; live CPM and
accuracy; a results screen; restart on Tab+Enter; light/dark theme.

**Scoring — be explicit and honest.** "Characters ÷ 5" is meaningless for Khmer.
Show **CPM (keystrokes/minute)** as the primary metric. If a WPM number is also
shown, define a word as 5 clusters and label it in the UI so nobody assumes the
score is comparable to a MonkeyType Latin score.

---

## Phase 4 — SQLite persistence

Put all storage behind an interface (`src/storage/index.ts`) so the backing
store is swappable. Then implement it with `@sqlite.org/sqlite-wasm`.

- Runs in a Web Worker; all calls are async message-passing.
- Use the `opfs-sahpool` VFS: no COOP/COEP headers needed, and faster than plain
  `opfs`. It pre-allocates a file pool and is **not multi-tab safe** — detect a
  second tab via BroadcastChannel and show a "already open in another tab"
  notice rather than corrupting data.
- Expect Vite friction serving the `.wasm` and the worker as a module. Set up
  `optimizeDeps.exclude` and the worker format correctly, and verify the
  production build works, not just dev.

Schema: `sessions` (id, started_at, mode, duration, cpm, accuracy) and
`keystrokes` (session_id, target_codepoint, typed_codepoint, correct, ms_since_prev).
Index whatever the Phase 5 queries need.

**Add a "Download my data" button** that exports the raw `.sqlite` file. OPFS can
be evicted by the browser under storage pressure, and Safari only gained support
in 17 — so an export path is a genuine safety net, not a nice-to-have. Add an
import button too.

---

## Phase 5 — Analytics (the reason we're using SQL)

Query and visualise:

- Per-cluster accuracy, ranked worst-first
- Which **subscript (coeng) consonants** are mistyped most, weighted by recency
- Mean time-to-keystroke per target codepoint (finds the hesitation keys, not
  just the error keys)
- Accuracy and CPM trend over the last 30 sessions

Then: a **drill mode** that generates practice text weighted toward the user's
worst clusters.

---

## Phase 6 — Ship

- `vite-plugin-pwa` with the font and WASM precached; must fully work offline.
- `netlify.toml`: build `npm run build`, publish `dist`, SPA redirect to `/index.html`.
- `README.md`: local dev, test, build, deploy, and a note on how to update the
  NiDA table.

---

## Corpus

Create `public/corpus/` with a documented JSON shape (`{ id, text, source, level }`)
and only ~20 placeholder sentences. I'll supply the real corpus. Load and
`stripInvisible()` at load time.

---

## Constraints

- No backend, no API keys, no paid services, no telemetry.
- No CSS-in-JS runtime; Tailwind only.
- Every dependency added beyond the list above needs a one-line justification.
- Don't add a component library. Plain Tailwind.
- If something in this spec turns out to be wrong once you're in the code, say
  so and stop — don't silently work around it.