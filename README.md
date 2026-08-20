# Khmer NiDA Typing Trainer

A MonkeyType-style typing trainer for the Khmer **NiDA** keyboard layout —
the layout that ships with Windows and macOS but that almost nobody is
taught to touch-type.

Vite + React + TypeScript. Static site, no backend, no accounts, no
telemetry. Session history and per-keystroke data live in SQLite over OPFS
in your own browser and never leave the device unless you export them.

---

## ⚠️ This is a vibe-coded project

Almost all of the code here was written by Claude (Claude Code), driven by
me from a written spec, phase by phase. I reviewed it, ran it, and pushed back on
it, but I did not hand-write most of it.

Read that as a warning label, not a brag:

- **The NiDA layout table is the one part that is not vibes.** It was read
  off the real Windows layout DLL by machine, never generated from memory,
  and a test fails if that flag flips. See
  [How to update the NiDA table](#how-to-update-the-nida-table).
- **The corpus is unverified.** `public/corpus/placeholder.json` is 20
  example sentences marked `"verified": false`. No fluent reader has signed
  off on them. It exercises the engine; it is not a curriculum.
- **Word segmentation is imperfect.** Khmer has no spaces between words, so
  boundaries come from `Intl.Segmenter`'s dictionary at corpus build time.
  It is decent, not correct.
- Everything else — the security review in `docs/`, the storage layer, the
  analytics — got the attention an AI-written personal project gets, which
  is more than zero and less than an audit.

If you are learning Khmer typing seriously, spot-check the keyboard diagram
against the official layout before you build muscle memory on it.

## What it does

- **Two input modes.** *OS layout* reads `event.key` if you already have the
  Khmer (NiDA) layout installed. *In-app remap* (default) reads `event.code`
  — physical key position — and maps it through our own table, so it works
  on any machine with nothing installed. Remap mode assumes QWERTY hardware.
- **Live keyboard hint** showing the next key and the whole NiDA layout.
- **Timed and word-count runs**, CPM/WPM, accuracy, live caret.
- **Your own text** — paste a passage and type against it.
- **Tap a word to see what it means**, from a bundled offline dictionary
  (~5 MB; see [Licences](#licences-read-this-before-you-fork)).
- **Statistics** — history, per-key accuracy, export and import.
- **Works offline.** A service worker precaches the shell, the Khmer font,
  the SQLite WASM binary and the corpus on first load.

## The two Khmer problems this is actually about

Most of the difficulty is not typing-trainer difficulty, it is Khmer text
difficulty:

**1. `Intl.Segmenter` is both banned and required.** It follows UAX #29,
which splits coeng (subscript) sequences — `ក្ក` comes out as two clusters
instead of one — so it is banned for grapheme clusters; `src/khmer/segment.ts`
does that with an explicit regex instead. But Khmer has no inter-word spaces
and `Intl.Segmenter` carries a word dictionary we cannot reproduce, so it is
required for word boundaries. That runs at corpus build time only, never at
runtime.

**2. Compare at the codepoint level, render at the cluster level.** One NiDA
keypress emits one codepoint, so correctness is judged per codepoint. But if
the caret lands *inside* a stacked glyph, the display visibly breaks — so
rendering and caret placement happen per cluster. `compare()` returns
per-codepoint states plus a codepoint→cluster index map for the renderer.

There is also a performance invariant the code takes seriously: **one
keypress re-renders exactly one `<Word>`.** The typed buffer lives in a ref,
not state; only the active word index and its typed string are state.

## Current status

| Thing | State |
|---|---|
| NiDA layout table | ✅ verified — read from the real layout, machine-extracted |
| Five ligature keys | ⚠️ known gap — emit two codepoints per press, don't type correctly in remap mode yet |
| Corpus | ❌ unverified placeholder, 20 sentences |
| Mobile | ❌ out of scope — Khmer entry goes through an IME, `keydown` gives you nothing usable |

The ligature keys: `KeyA`+shift = `ាំ`, `Semicolon`+shift = `ោះ`, `KeyV`+shift
= `េះ`, and `Comma` on both layers. NiDA also maps non-Khmer characters —
`«»` on the backquote key, ZWJ/ZWNJ on AltGr, ASCII punctuation across the
digit row.

## Running it locally

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc --noEmit, then production build -> dist/
npm run preview    # serve dist/ locally
npm test           # Vitest (single run)
npm run typecheck  # tsc --noEmit only
npm run dict       # rebuild public/dict.json from upstream (slow, by hand only)
```

**Always check `npm run preview`, not just `npm run dev`.** The SQLite WASM
runs in a Web Worker, and the friction around bundling the `.wasm` and the
worker as a module shows up in the production build, not in dev.

Also: test Khmer rendering in an actual browser. Terminal output is not
reliable for stacked glyphs.

## Deploying

Netlify: connect the repo, build command `npm run build`, publish directory
`dist`. `netlify.toml` already encodes this plus an SPA redirect.

The output is a fully static bundle — no serverless functions, no env vars,
no server-side auth — so any static host (Vercel, GitHub Pages, Cloudflare
Pages, an S3 bucket) works the same way. Security headers live in
`public/_headers`.

## Privacy and your data

Sessions and per-keystroke data are stored locally in SQLite
(`@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) in a Web Worker — see
`src/storage/index.ts`. Nothing is sent anywhere. `localStorage` holds your
settings and, if you use "Insert your own text", the quote you pasted.

Keyboard handlers bind to the typing input element only — never to
`document` or `window`. The input is visible and click-to-focus and is never
autofocused, so you can always see when keystrokes are being recorded, and
blurring it pauses the run. That is a deliberate privacy property, not a UX
preference.

**OPFS is not encrypted at rest.** On a shared machine — a lab, a school, an
internet café — anyone with access to the same OS account can read the
browser profile and recover this data. **Don't paste anything private into
"Insert your own text."**

In the Statistics tab:

- **Download my data (.sqlite3)** exports the raw database. Do this
  periodically — browsers can evict OPFS under storage pressure.
- **Download as JSON** exports the same history in the format import accepts.
- **Import a JSON export** replaces your entire local history (gated by a
  confirm; destructive and not undoable). Import deliberately refuses raw
  `.sqlite3` files — handing an uploaded file to the SQLite parser is exactly
  the attack surface a restore feature should not open. Every field is
  validated; a bad file fails the whole import rather than silently dropping
  rows.
- **Clear all my data** removes the underlying OPFS file itself, not just its
  rows, then starts a fresh database.

The database can only be open in one tab at a time — `opfs-sahpool` is not
multi-tab safe, so a second tab says "Already open in another tab".

Whoever hosts the page keeps ordinary web-server access logs (IP, user
agent, files fetched). Nothing you type, paste or store appears in them.

---

## Licences (read this before you fork)

This repo has **two different licence regimes in it.** They are not the same
and the difference matters.

### The application source: proprietary, no licence granted

© 2026 SovanChy. All rights reserved — see [LICENSE](LICENSE). This is
personal portfolio work, deliberately **not** MIT or any other open-source
licence, which would grant exactly the rights I am not granting. No
permission to use, copy, modify or redistribute the source. Viewing the repo
or using a hosted instance grants no rights in the code. `package.json`
carries `"license": "UNLICENSED"` and `"private": true` so it cannot reach
npm by accident.

### The dictionary data: other people's work, other people's terms

`public/dict.json` is **not mine and not covered by the above.** It is built
by `scripts/build-dict.mjs` as a mechanical merge (first sense only) of the
upstream dictionaries below, and is therefore a derivative of each. Full
detail in [NOTICE.md](NOTICE.md).

| Source | What | Licence |
|---|---|---|
| វចនានុក្រមខ្មែរ (Chuon Nath), Buddhist Institute 1967, digitised by the [Open Institute](https://github.com/interscript/khmer-dict-spice) under USAID SPICE | Khmer definitions | **LGPL-2.1** ([full text](LICENSES/khmer-dict-LGPL-2.1.txt)) |
| [English Wiktionary](https://kaikki.org/dictionary/Khmer/) via [wiktextract](https://github.com/tatuylonen/wiktextract) | English glosses | **CC BY-SA** |
| [Khmer Wiktionary](https://km.wiktionary.org) API (~1,400 words, kept only where the entry is not itself a copy of Chuon Nath) | Modern Khmer definitions | **CC BY-SA** |
| `@fontsource-variable/noto-sans-khmer` | Bundled Khmer font | **SIL OFL 1.1** |

Two consequences that are load-bearing, not decorative:

1. **The data ships as a standalone file the app reads at runtime.** It is
   not compiled into the bundle. Under LGPL-2.1 §6 that makes it a separate
   work: you can replace `public/dict.json` with a modified copy without
   touching or rebuilding the application. That separation is what lets a
   proprietary app ship it at all — don't collapse it by inlining the
   dictionary into the bundle.
2. **CC BY-SA needs attribution downstream.** The app carries it in the
   dictionary panel at runtime, next to the Khmer attribution. If you reuse
   the data, carry it too, and share alike.

So: the dictionary is free for you to take under its own terms. The trainer
around it is not.

Cite for wiktextract: Tatu Ylonen, *Wiktextract: Wiktionary as
Machine-Readable Structured Data*, LREC 2022.

### Warranty

Provided as-is, without warranty of any kind, and with no liability for how
it is used or for anything a user chooses to type into it.

---

## How to update the NiDA table

The table lives in `src/keyboard/nida.json`, loaded by `src/keyboard/nida.ts`
as `NIDA: NidaTable`. One entry:

```json
{
  "verified": true,
  "source": "Read from the Khmer (NIDA) layout installed on Windows ...",
  "keys": {
    "KeyQ": { "base": "ឆ", "shift": "ឈ", "altgr": null }
  }
}
```

- `verified` — `false` until a human vouches for `keys` against the official
  layout. `src/App.tsx` and `src/keyboard/KeyboardHint.tsx` read this flag to
  decide whether to show the "not verified" banner.
- `source` — free text recording where the table came from, so the next
  person doesn't have to guess whether it was measured or typed in.
- `keys` — keyed by `KeyboardEvent.code` (physical position, not the
  character the OS produces). ~50 keys; the list is `TYPING_KEY_CODES`.
- Three layers per key: `base`, `shift`, `altgr`. Each holds one codepoint, a
  two-codepoint ligature, or `null`.

**Read it out of the layout DLL rather than typing it in.**
`LoadKeyboardLayout` for KLID `00010453` (`KBDKNI.DLL`), then
`MapVirtualKeyEx` + `ToUnicodeEx` per scan code, once per layer. Two traps
that silently corrupt the result:

- Declare the P/Invoke with `CharSet.Unicode`. The .NET default is ANSI,
  which marshals the UTF-16 buffer back through CP1252 and hands you Latin-1
  characters whose low byte happens to match the Khmer codepoint.
- `ToUnicodeEx` carries dead-key state between calls. Flush it between
  queries or one dead key contaminates the next.

Then `npm test`. `src/keyboard/nida.test.ts` asserts, over every entry: the
key is a real typing `code`; each non-null layer is one codepoint (or a
codepoint plus a combining mark); no layer is a Latin letter or digit (the
signature of a capture taken with the wrong OS layout active); every letter
key carries at least one Khmer codepoint; no codepoint is mapped twice; and
`verified` is still `true`, so the flag reverting fails a test instead of
quietly re-enabling the warning banner.

**Do not hand-write or "fix" individual mappings from memory.** A wrong
layout is worse than no app — it teaches muscle memory that has to be
unlearned later.

## How to supply a real corpus

Corpus files live in `public/corpus/`; `loadCorpus()` in `src/corpus/index.ts`
loads `placeholder.json` by default. Top level is `{ "entries": [...] }`:

```json
{ "id": "p01", "text": "​ទឹក​បាយ​សាលា​។", "source": "placeholder", "level": "beginner" }
```

- `id` — non-empty string.
- `text` — the Khmer passage, with word boundaries marked by `U+200B`
  (ZWSP) — invisible to a reader and never typed. `parseCorpus()` splits
  words on ZWSP first, then `stripInvisible()` removes it from the text
  actually shown, so nobody is asked to type an invisible character.
- `source` — non-empty string.
- `level` — `beginner` | `intermediate` | `advanced`.

Malformed entries are dropped silently rather than crashing the app, since
this file is hand-edited and therefore untrusted input.

Verified corpus text from fluent readers is the single most useful thing
anyone could send. Open an issue.
