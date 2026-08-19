# Third-party data

The application source in `src/` is © 2026 SovanChy, all rights reserved. The
files listed here are not, and carry their own terms. Each is shipped as a
standalone data file that the application reads at runtime — none of them is
compiled into the bundle, and each can be replaced without rebuilding the app.

## `public/dict.json`

Built by `scripts/build-dict.mjs` from two upstream dictionaries. It is a
mechanical merge of both — first sense only — and is therefore a derivative of
each. Rebuild it with `npm run dict`.

### វចនានុក្រមខ្មែរ — Khmer definitions

The monolingual Khmer dictionary revised by Samdech Chuon Nath (1883–1969),
published by the **Buddhist Institute, Cambodia** (1967). Digitised by the
**Open Institute** under the USAID-funded SPICE programme, and distributed at
<https://github.com/interscript/khmer-dict-spice> as `kh_dictionary.csv`.

Licence: **LGPL-2.1**, full text in `LICENSES/khmer-dict-LGPL-2.1.txt`.

Under §6 of that licence the data is used as a separate work that this program
reads; it is not linked into the program, and the recipient can replace
`public/dict.json` with a modified copy without touching the application.

### Wiktionary — English glosses and modern Khmer definitions

Two things, from two wikis:

- **English glosses** for Khmer headwords, extracted from the English Wiktionary
  by [wiktextract](https://github.com/tatuylonen/wiktextract) and distributed at
  <https://kaikki.org/dictionary/Khmer/>.
- **Modern Khmer definitions** read from [Khmer Wiktionary](https://km.wiktionary.org)
  through its API. Roughly 1,400 words, kept only where the entry is not itself
  a copy of Chuon Nath — km.wiktionary sources many of its entries from it.

Licence: **CC BY-SA** (Wiktionary's own terms). Attribution is carried in the
dictionary panel in the running application, alongside the Khmer attribution
above.

Cite: Tatu Ylonen, *Wiktextract: Wiktionary as Machine-Readable Structured
Data*, LREC 2022.

## `@fontsource-variable/noto-sans-khmer`

Noto Sans Khmer, under the SIL Open Font License 1.1. See the licence shipped
inside the npm package.
