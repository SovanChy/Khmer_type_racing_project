# Khmer NiDA Typing Trainer

A typing trainer for the Khmer **NiDA** keyboard layout —

Static site: no backend, no accounts, no telemetry. Everything you type
stays in your own browser.

## What it does

- **Works without installing the layout.** *In-app remap* (default) reads
  the physical key you press and maps it through the NiDA table, so it works
  on any QWERTY machine with nothing installed. If you already have the
  Khmer (NiDA) layout installed, switch to *OS layout* mode instead.
- **Live keyboard hint** showing the next key and the whole NiDA layout.
- **Timed and word-count runs**, with CPM/WPM, accuracy and a live caret.
- **Your own text** — paste a passage and type against it.
- **Tap a word to see what it means**, from a bundled offline dictionary.
- **Statistics** — history, per-key accuracy, export and import.
- **Works offline** after the first load.


## Privacy

Your session history and per-keystroke data are stored locally in your
browser and never sent anywhere. From the Statistics tab you can export
everything, import it back, or delete it outright.

The typing box is a normal, visible input that you have to click to focus —
keystrokes are only ever read while it is focused, so you can always see
when they're being recorded.

**Local storage is not encrypted.** On a shared machine, anyone using the
same OS account can read it — so don't paste anything private into "Insert
your own text." Browsers can also evict this data under storage pressure, so
export occasionally if your history matters to you.

## Running it locally

```bash
npm install
npm run dev        # dev server
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
npm test
```

Deploying: it's a fully static bundle, so any static host works. For
Netlify, `netlify.toml` already sets the build command and publish
directory.

---

## Licences

Two different licence regimes live in this repo, and the difference matters.

**The app is free to use, just not to sell.** © 2026 SovanChy — see
[LICENSE](LICENSE). Run it, fork it, learn from it, share it. Don't sell it
or build a paid product on it.

**The dictionary data is not mine.** `public/dict.json` is a mechanical
merge of the dictionaries below and is covered by their terms, not mine.
Full detail in [NOTICE.md](NOTICE.md).

| Source | What | Licence |
|---|---|---|
| វចនានុក្រមខ្មែរ (Chuon Nath), Buddhist Institute 1967, digitised by the [Open Institute](https://github.com/interscript/khmer-dict-spice) | Khmer definitions | **LGPL-2.1** |
| [English Wiktionary](https://kaikki.org/dictionary/Khmer/) via [wiktextract](https://github.com/tatuylonen/wiktextract) | English glosses | **CC BY-SA** |
| [Khmer Wiktionary](https://km.wiktionary.org) | Modern Khmer definitions | **CC BY-SA** |
| `@fontsource-variable/noto-sans-khmer` | Bundled Khmer font | **SIL OFL 1.1** |

The dictionary ships as a standalone file the app reads at runtime rather
than being compiled into the bundle — under LGPL-2.1 §6 that keeps it a
separate work, which is what lets a differently-licensed app ship it at
all — so don't inline it. If you reuse the data, carry the attribution and
share alike.

Cite for wiktextract: Tatu Ylonen, *Wiktextract: Wiktionary as
Machine-Readable Structured Data*, LREC 2022.

Provided as-is, without warranty of any kind.
