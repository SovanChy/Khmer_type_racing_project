# Khmer NiDA Typing Trainer

A MonkeyType-style typing trainer for the Khmer **NiDA** keyboard layout.
Vite + React + TypeScript, static site, no backend, no accounts, no
telemetry. Session history and keystroke data are stored locally in the
browser (SQLite over OPFS) and never leave the device unless you export them.

## Status: the NiDA layout is unverified placeholder data

`src/keyboard/nida.json` currently ships with `"verified": false`. Every
codepoint in its `keys` table is a deliberately sequential placeholder
(`U+1780`, `U+1781`, `U+1782`, ...) chosen only to pin the file's shape for
tests — it is **not** the real NiDA layout.

Practical effect: "In-app remap mode" (the default input mode) currently maps
physical key positions to these placeholder codepoints, not real Khmer
letters, so it produces nonsense. `src/App.tsx` shows a blocking warning
banner whenever `inputMode === 'remap' && !NIDA.verified`. Use "OS layout
mode" (requires the real Khmer NiDA layout installed at the OS level) until
the table is replaced — do not practise on remap mode in this state, a wrong
layout teaches wrong muscle memory. See "How to update the NiDA table" below.

`public/corpus/placeholder.json` is separately marked `"verified": false` too
— it is 20 unverified example sentences, not a curated corpus.

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
  "verified": false,
  "keys": {
    "KeyQ": { "base": "\u1780", "shift": "\u1781", "altgr": null }
  }
}
```

- `verified` — `false` until a human vouches for `keys` against the official
  NiDA layout. `src/App.tsx` reads this flag directly to decide whether to
  show the "not verified" warning in remap mode.
- `keys` — keyed by `KeyboardEvent.code` (physical key position, not the
  character the OS layout produces), one entry per key that can carry a
  character: ~50 keys total — 26 letters, 10 digits, and punctuation (the
  full list is `TYPING_KEY_CODES` in `nida.ts`).
- Each entry has three layers: `base` (no modifier), `shift`, and `altgr`
  (AltGr / right-Alt). Each layer holds exactly one Khmer codepoint, or
  `null` if that layer is unmapped.

To replace the table:

1. Replace the whole `keys` object with the verified mapping from the
   official NiDA layout.
2. Set `verified` to `true`.
3. Run `npm test`. `src/keyboard/nida.test.ts` validates, over every entry in
   `NIDA.keys`:
   - the key is a real typing `KeyboardEvent.code` (`TYPING_KEY_CODES`)
   - each non-null layer value is exactly one codepoint
   - each non-null layer value is a valid assigned Khmer codepoint
     (`KHMER_CODEPOINT`: U+1780-U+17DD, U+17E0-U+17E9, U+17F0-U+17F9)
   - no codepoint is mapped twice anywhere in the table
   - one test asserts `NIDA.verified` is `false` — its own comment says to
     delete that test once the table is verified, since flipping the flag is
     the deliberate act of vouching for the data.

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

In OS-layout mode the app also records, in `localStorage`, which character
each physical key produced on your machine — this is what fills in the
on-screen keyboard diagram. It is derived from your keystrokes, so it is the
same category of data as the keystroke table above: local only, never sent
anywhere, and cleared by "Clear all my data". Only Khmer codepoints are kept;
anything else you type is discarded rather than recorded.

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
  saved settings and the learned keyboard layout. This is gated by a
  confirmation dialog and cannot be undone.
- The database can only be open in one tab at a time — the `opfs-sahpool`
  VFS isn't multi-tab safe. A second tab shows "Already open in another tab"
  and won't record sessions until the first tab closes.
