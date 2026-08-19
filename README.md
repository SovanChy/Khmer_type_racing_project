# Khmer NiDA Typing Trainer

A MonkeyType-style typing trainer for the Khmer **NiDA** keyboard layout.
Vite + React + TypeScript, static site, no backend, no accounts, no
telemetry. Session history and keystroke data are stored locally in the
browser (SQLite over OPFS) and never leave the device unless you export them.

## Status: the NiDA layout is real, the corpus is not

`src/keyboard/nida.json` ships with `"verified": true`. The table was read
directly off the "Khmer (NIDA)" layout installed on Windows (KLID
`00010453`, `KBDKNI.DLL`) by calling `ToUnicodeEx` over PS/2 set-1 scan
codes for all three layers — not transcribed by hand, and not generated from
memory. See "How to update the NiDA table" below for how to redo that on
your own machine.

Two things the real layout turned out to contradict, both worth knowing
before trusting the spec over the data:

- **Five keys are ligatures that emit two codepoints in one press**
  (`KeyA`+shift = `ាំ`, `Semicolon`+shift = `ោះ`, `KeyV`+shift = `េះ`,
  `Comma` on both layers). The typing engine compares one codepoint per
  keypress, so those five keys do not yet type correctly in remap mode.
- **NiDA maps non-Khmer characters**: `«»` on the backquote key, ZWJ/ZWNJ on
  the AltGr layer, and ASCII punctuation across the digit row.

`public/corpus/placeholder.json` is still marked `"verified": false` — it is
20 unverified example sentences, not a curated corpus.

## Local development

```bash
npm run dev        # Vite dev server
npm run build      # tsc --noEmit, then production build -> dist/
npm run preview    # serve dist/ locally
npm test           # Vitest (single run)
npm run test:watch # Vitest, watch mode
npm run typecheck  # tsc --noEmit only
```

Always check `npm run preview`, not just `npm run dev`. The SQLite WASM
runs in a Web Worker, and the friction around bundling the `.wasm` and the
worker as a module shows up in the production build, not in dev — code that
works under `npm run dev` can still break under `npm run preview`.

## Deploy

Netlify: connect the repo, build command `npm run build`, publish directory
`dist`. `netlify.toml` in the repo root already encodes this, plus an SPA
redirect (`/*` -> `/index.html`, status 200) so client-side routes don't 404
on refresh.

The output is a fully static bundle — no serverless functions, no env vars,
no server-side auth — so any static host (Vercel, GitHub Pages, Cloudflare
Pages, a plain S3 bucket, ...) works the same way; `netlify.toml` is just
config Netlify happens to read.

## Offline

The app registers a service worker (via `vite-plugin-pwa`) that precaches the
app shell, the bundled Khmer font, the SQLite WASM binary, and the corpus
JSON on first load. After that first load, the app works fully offline — no
network request is needed to run a typing test, see live stats, or view
analytics from local history.

## How to update the NiDA table

The table lives in `src/keyboard/nida.json` and is loaded by
`src/keyboard/nida.ts` as `NIDA: NidaTable`. Shape of one entry, copied from
the real file:

```json
{
  "verified": true,
  "source": "Read from the Khmer (NIDA) layout installed on Windows ...",
  "keys": {
    "KeyQ": { "base": "\u1786", "shift": "\u1788", "altgr": null }
  }
}
```

- `verified` — `false` until a human vouches for `keys` against the official
  NiDA layout. `src/App.tsx` and `src/keyboard/KeyboardHint.tsx` read this
  flag directly to decide whether to show the "not verified" warning.
- `source` — free text recording where the table came from, so the next
  person does not have to guess whether it was measured or typed in.
- `keys` — keyed by `KeyboardEvent.code` (physical key position, not the
  character the OS layout produces), one entry per key that can carry a
  character: ~50 keys total — 26 letters, 10 digits, and punctuation (the
  full list is `TYPING_KEY_CODES` in `nida.ts`).
- Each entry has three layers: `base` (no modifier), `shift`, and `altgr`
  (AltGr / right-Alt). A layer holds one codepoint, a two-codepoint ligature
  (see the five keys listed at the top of this file), or `null` if unmapped.

To rebuild the table from a Windows machine with the layout installed, read
it out of the layout DLL rather than typing it in — `LoadKeyboardLayout` for
KLID `00010453`, then `MapVirtualKeyEx` + `ToUnicodeEx` per scan code, once
per layer. Two traps that silently corrupt the result:

- Declare the P/Invoke with `CharSet.Unicode`. The .NET default is ANSI,
  which marshals the UTF-16 buffer back through CP1252 and hands you Latin-1
  characters whose low byte happens to match the Khmer codepoint.
- `ToUnicodeEx` carries dead-key state between calls; flush it between
  queries or a dead key contaminates the next one.

Then run `npm test`. `src/keyboard/nida.test.ts` validates, over every entry
in `NIDA.keys`:

- the key is a real typing `KeyboardEvent.code` (`TYPING_KEY_CODES`)
- each non-null layer is one codepoint, or a codepoint plus a combining mark
- no layer is a Latin letter or digit — the signature of a table captured
  while the wrong OS layout was active (`KeyQ` = `"q"`)
- every letter key carries at least one Khmer codepoint
- no codepoint is mapped twice anywhere in the table
- `NIDA.verified` is `true`, so the flag silently reverting fails a test
  rather than quietly re-enabling the "do not practise on this" banner

Do not hand-write or "fix" individual mappings from memory. A wrong layout is
worse than no app — it teaches muscle memory that later has to be unlearned.

## How to supply a real corpus

Corpus files live in `public/corpus/`. The app currently loads
`public/corpus/placeholder.json` by default (`loadCorpus()` in
`src/corpus/index.ts`), 20 unverified placeholder sentences meant only to
exercise the typing engine.

Entry shape (top level is `{ "entries": [...] }`), copied from the real
file:

```json
{ "id": "p01", "text": "\u200bទឹក\u200bបាយ\u200bសាលា\u200b។", "source": "placeholder", "level": "beginner" }
```

- `id` — non-empty string.
- `text` — the Khmer passage. Word boundaries are marked with `U+200B`
  (zero-width space, ZWSP) — invisible to a reader, never typed by a user.
  `parseCorpus()` splits words on ZWSP first, then `stripInvisible()` removes
  it from the text actually shown/typed against, so nobody is ever asked to
  type an invisible character.
- `source` — non-empty string.
- `level` — one of `beginner` | `intermediate` | `advanced`.

Malformed entries (missing/empty fields, an unrecognised `level`, or text
with no words after splitting) are dropped silently rather than crashing the
app, since this file is hand-edited and therefore untrusted input.

## Your data

Sessions and per-keystroke data are stored locally in a SQLite database
(`@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) running in a Web Worker —
see `src/storage/index.ts`. Nothing is sent anywhere.

**OPFS is not encrypted at rest.** On a shared machine — a lab, a school, an
internet café — anyone with access to the same OS account can read the
browser profile and recover this data. Keep that in mind if this is used
somewhere other than a personal device.

`localStorage` holds your settings (input mode, theme, keyboard visibility)
and, if you use "Insert your own text", the quote you pasted — so it is still
there after a reload. Both are cleared by "Clear all my data".

**Do not paste anything private into "Insert your own text".** The quote and
every keystroke you type against it are written to the local database
described above. Nothing is uploaded, but see the OPFS note: it is not
encrypted, and anyone who can use the same browser profile can read it back.

An earlier version also recorded, in `localStorage`, which character each
physical key produced on your machine, to fill in the keyboard diagram in OS
mode. That feature is gone — the diagram now reads `nida.json` in both input
modes. "Clear all my data" still removes the old `knt.oslayout` key so an
upgrade does not strand it.

- **Download my data (.sqlite3)**, in the "Your data" panel, exports the raw
  database file. Do this periodically: OPFS storage can be evicted by the
  browser under storage pressure, so an export is a real backup, not a
  nice-to-have.
- **Download as JSON** exports the same history in a plain JSON format (see
  `parseExport()` in `src/storage/schema.ts` for the exact shape). This is
  the format import accepts.
- **Import a JSON export** replaces your entire local history with a
  previously exported `.json` file (a confirmation dialog gates this — it's
  destructive and not undoable). Import intentionally does **not** accept a
  raw `.sqlite3` file: that would hand an uploaded file straight to the
  SQLite parser, which is exactly the attack surface a "restore" feature
  should not open up. Every field in an imported file is validated — wrong
  types, out-of-range values, or an oversized file are rejected outright,
  with the whole import failing rather than silently dropping bad rows.
- **Clear all my data** closes the database connection and removes the
  underlying OPFS file itself (not just its rows — a row-level `DELETE`
  leaves the bytes recoverable in the file), then starts a fresh empty
  database so the app keeps working without a reload. It also clears your
  saved settings, your pasted quote, and the layout key left over from the
  removed learning feature. This is gated by a
  confirmation dialog and cannot be undone.
- The database can only be open in one tab at a time — the `opfs-sahpool`
  VFS isn't multi-tab safe. A second tab shows "Already open in another tab"
  and won't record sessions until the first tab closes.

## Copyright and use

© 2026 SovanChy. All rights reserved. This is personal portfolio work, not
open source — see [LICENSE](LICENSE). No permission is granted to use, copy,
modify or redistribute the source. Deliberately **not** MIT or any other
open-source licence, which would grant exactly those rights.

`package.json` carries `"license": "UNLICENSED"` and `"private": true`, so
the package cannot be published to npm by accident.

The application itself is provided as-is, without warranty, and with no
liability for how it is used or for anything a user chooses to type into it.

No accounts, no analytics, no telemetry, no third-party scripts. The only
thing that leaves the user's machine is the request for the page itself, so
whoever hosts it (Netlify, by default) keeps the ordinary web-server access
logs — IP address, user agent, which files were fetched. None of what a user
types, pastes, or stores appears in them.
