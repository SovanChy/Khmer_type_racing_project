// Builds public/dict.json from three upstream dictionaries. Run by hand:
//
//   npm run dict
//
// The output is committed. Deploys must not depend on GitHub, kaikki.org and
// km.wiktionary all being up, and none of them changes on a schedule worth
// automating. Takes a couple of minutes, most of it the polite wiki crawl.
//
// Sources and their licences are recorded in NOTICE.md. Nothing here runs at
// runtime, and nothing the app ships talks to any of these hosts.

import { writeFileSync } from 'node:fs';

/** Chuon Nath (Buddhist Institute 1967), digitised by the Open Institute. LGPL-2.1. */
const CHUON_NATH =
  'https://raw.githubusercontent.com/interscript/khmer-dict-spice/master/kh_dictionary.csv';

/** English Wiktionary Khmer entries, extracted by wiktextract. CC BY-SA. */
const WIKTIONARY = 'https://kaikki.org/dictionary/Khmer/kaikki.org-dictionary-Khmer.jsonl';

/**
 * Khmer Wiktionary — modern Khmer-language definitions. CC BY-SA.
 *
 * Read through the API rather than the dump: the XML dump is bzip2, which node
 * cannot decompress without a dependency, and the gzipped CirrusSearch dumps
 * were deprecated in January 2026. That leaves ~75 polite requests, which is
 * acceptable for a script run by hand a couple of times a year.
 */
const KM_WIKTIONARY = 'https://km.wiktionary.org/w/api.php';

/** Wikimedia asks for a descriptive agent with a contact. */
const AGENT = 'khmer-nida-trainer/0.1 (dictionary build; sovan.chy.work@gmail.com)';

/** One request per second, and `maxlag` backs off when the cluster is busy. */
const POLITE_MS = 1000;

/** Khmer full stop. Chuon Nath packs every sense into one field, separated by these. */
const KHAN = '។';

/**
 * Caps. A dictionary panel is a gloss, not a reading pane — and the whole file
 * is downloaded before the first lookup can answer, so length here is latency
 * for the user. Full entries measured 1.2MB brotli against 580KB trimmed.
 */
const KH_MAX = 160;
const EN_MAX = 140;

const trim = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s);

/**
 * Minimal RFC4180 reader. The definition column contains commas, quotes and
 * newlines, so splitting on commas produces garbage — but pulling in a CSV
 * dependency for one field of one file at build time is worse.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Chuon Nath definitions carry the dictionary's own cross-reference markup:
 * `<"8672">ព្យញ្ជនៈ/a` links a word to entry 8672. We show plain text, and the
 * ids are meaningless outside their own app.
 */
const stripRefs = (s) =>
  s
    .replace(/<"\d+">/g, '')
    .replace(/\/a/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One MediaWiki API call, rate-limited. */
async function api(params) {
  const url = new URL(KM_WIKTIONARY);
  for (const [k, v] of Object.entries({ format: 'json', maxlag: '5', ...params })) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
  await sleep(POLITE_MS);
  if (!res.ok) throw new Error(`km.wiktionary ${res.status} — try again later`);

  const body = await res.json();
  if (body.error) throw new Error(`km.wiktionary: ${body.error.code}`);
  return body;
}

/**
 * Khmer-language sections cleaned out of Khmer Wiktionary wikitext.
 *
 * Returns [word, definition] pairs. Only about 1,600 of the wiki's 34,000
 * Khmer-titled pages actually define a Khmer word — the rest are entries in
 * other languages that merely carry a Khmer translation — so the search below
 * narrows the set before anything is downloaded.
 */
async function khmerWiktionary() {
  process.stdout.write('searching km.wiktionary… ');
  const titles = [];

  for (let offset = 0; ; ) {
    const page = await api({
      action: 'query',
      list: 'search',
      // Regex search: a plain-text `insource` returns nothing for this string.
      srsearch: 'insource:/==ខ្មែរ==/',
      srnamespace: '0',
      srlimit: '500',
      sroffset: String(offset),
    });

    // A Latin-titled page containing this heading is another language's entry
    // with a Khmer translation block, not a Khmer word.
    titles.push(...page.query.search.map((s) => s.title).filter((t) => KHMER_START.test(t)));

    const next = page.continue?.sroffset;
    if (next === undefined) break;
    offset = next;
  }
  console.log(`${titles.length} candidate pages`);

  const found = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    process.stdout.write(`\r  fetching ${i + batch.length}/${titles.length}…`);

    const page = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: batch.join('|'),
    });

    for (const p of Object.values(page.query.pages)) {
      const wikitext = p.revisions?.[0]?.slots?.main?.['*'];
      if (!wikitext) continue;
      const definition = khmerSection(wikitext);
      if (definition) found.push([p.title, definition]);
    }
  }
  console.log(`\r  ${found.length} Khmer definitions found${' '.repeat(20)}`);
  return found;
}

const KHMER_START = /^[ក-៿]/;

/**
 * Subsection headings that introduce something other than a definition.
 *
 * Dropping the whole block, not just the heading, is the point: keeping the
 * heading text produced entries reading "noun synonyms translation noun" —
 * heading soup that passes a "contains Khmer" check while meaning nothing.
 */
const NOT_DEFINITION =
  /(ការបញ្ចេញសំលេង|បកប្រែ|បំណកប្រែ|បំនកប្រែ|មើលផងដែរ|និរុត្តិសាស្ត្រ|ពាក្យសំរង់|ពាក្យទាក់ទង|ពាក្យបងប្អូន|សូមមើល|ឯកសារយោង)/;

/** The wiki also appends translation lists inline, under a bare label. */
const TRANSLATION_TAIL = /(?:អង់គ្លេស|បារាំង|ជប៉ុន)\s*៖[\s\S]*$/;

/** `[[File:…|thumb|right|…]]` and category links carry no definition text. */
const MEDIA_OR_CATEGORY =
  /\[\[\s*(?:File|Image|Category|ឯកសារ|រូបភាព|ចំណាត់ថ្នាក់ក្រុម)\s*:[\s\S]*?\]\]/gi;

/**
 * Pull the Khmer-language definition out of one page's wikitext.
 *
 * Returns null when the page has no Khmer section, or when what is left after
 * stripping markup is too thin to be a definition — plenty of entries are a
 * bare template with no prose at all.
 */
function khmerSection(wikitext) {
  const section = wikitext.match(/==\s*(?:ភាសាខ្មែរ|ខ្មែរ)\s*==([\s\S]*?)(?=\n==[^=]|$)/);
  if (!section) return null;

  // Split on headings of any level, then keep only the blocks that define.
  const blocks = section[1].split(/\n(?==+[^=\n]+=+)/);
  const defining = blocks
    .filter((block) => {
      const heading = block.match(/^=+([^=\n]+)=+/);
      return !heading || !NOT_DEFINITION.test(heading[1]);
    })
    .map((block) => block.replace(/^=+[^=\n]+=+/, ' '));

  const text = defining
    .join(' ')
    // Entities first: the dump escapes tags, so stripping <ref> before decoding
    // leaves the ref's text behind with "ref" still in it.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(MEDIA_OR_CATEGORY, ' ')
    .replace(/=+/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ') // templates: {{km-noun}} and friends
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1') // links keep their label
    .replace(/'''?/g, '')
    .replace(/^[#*:;]+/gm, ' ')
    .replace(TRANSLATION_TAIL, '')
    .replace(/\s+/g, ' ')
    .trim();

  // A real definition is Khmer prose. One stray word or a leftover category
  // link is not worth showing next to Chuon Nath.
  return (text.match(/[ក-៿]/g) ?? []).length >= 15 ? text : null;
}

async function get(url, what) {
  process.stdout.write(`fetching ${what}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  console.log(`${Math.round(text.length / 1024)}KB`);
  return text;
}

const dict = {};

// --- Khmer definitions ------------------------------------------------------
const rows = parseCsv(await get(CHUON_NATH, 'Chuon Nath'));
const [header, ...body] = rows;
if (header?.[1] !== 'word' || header?.[2] !== 'definition') {
  throw new Error(`unexpected columns: ${header?.join(',')} — upstream format changed`);
}
for (const [, word, definition] of body) {
  if (!word || !definition) continue;
  // First sense only. The rest is etymology, examples and cross-references.
  const first = stripRefs(definition).split(KHAN)[0].trim();
  if (first) dict[word] = [trim(first, KH_MAX)];
}
const khCount = Object.keys(dict).length;

// --- English glosses --------------------------------------------------------
let enCount = 0;
for (const line of (await get(WIKTIONARY, 'Wiktionary')).split('\n')) {
  if (!line) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue; // One malformed line must not lose the other 11,000.
  }
  if (entry.lang_code !== 'km' || !entry.word) continue;

  const glosses = (entry.senses ?? []).flatMap((s) => s.glosses ?? []).filter(Boolean);
  if (glosses.length === 0) continue;

  const gloss = `${entry.pos ? `(${entry.pos}) ` : ''}${glosses.slice(0, 2).join('; ')}`;
  // First part of speech wins. Later homographs are separate senses of the
  // same spelling, and a gloss panel that lists all of them stops being a gloss.
  const existing = dict[entry.word] ?? (dict[entry.word] = ['']);
  if (!existing[1]) {
    existing[1] = trim(gloss, EN_MAX);
    enCount++;
  }
}

// --- Modern Khmer definitions ----------------------------------------------
let modernCount = 0;
let copiedCount = 0;
for (const [word, definition] of await khmerWiktionary()) {
  const entry = dict[word] ?? (dict[word] = ['']);
  if (entry[2]) continue;

  // Khmer Wiktionary sources a lot of its entries straight from Chuon Nath.
  // Showing the same sentence twice, the second time labelled "modern", is
  // worse than showing it once under the dictionary it actually came from.
  if (sameText(entry[0], definition)) {
    copiedCount++;
    continue;
  }

  entry[2] = trim(definition, KH_MAX);
  modernCount++;
}

/**
 * Whether two definitions are the same text in different clothes.
 *
 * Khmer letters only, and NOT Khmer punctuation: the two copies differ both in
 * how they punctuate the part-of-speech marker — `ចិ.(ន.)` against `( ចិ. )` —
 * and in whether senses are separated by `។` or by `:`. Keeping ។ in the
 * comparison let 163 verbatim copies through.
 *
 * Compares a window taken from inside the shorter text rather than its start,
 * because that marker sits at the start and differs there by design.
 */
function sameText(a, b) {
  // U+1780–U+17D3 is consonants, vowels and diacritics; U+17D4 upwards is
  // punctuation (។ ៕ ៗ …) and digits, which is what differs between copies.
  const letters = (s) => (s ?? '').replace(/[^ក-៓]/g, '');
  const [x, y] = [letters(a), letters(b)];
  if (!x || !y) return false;

  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const window = 30;
  if (short.length < window) return long.includes(short);

  const from = Math.floor(short.length * 0.2);
  return long.includes(short.slice(from, from + window));
}

const out = 'public/dict.json';
const json = JSON.stringify(dict);
writeFileSync(out, json);
console.log(
  `\n${out}: ${Object.keys(dict).length} words ` +
    `(${khCount} Chuon Nath, ${enCount} English, ${modernCount} modern Khmer; ` +
    `${copiedCount} modern entries skipped as copies of Chuon Nath), ` +
    // Bytes, not string length: Khmer is three UTF-8 bytes per character, so
    // `.length` understates this file by a factor of three.
    `${Math.round(Buffer.byteLength(json) / 1024)}KB raw`,
);
