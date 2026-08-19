# Security Audit Findings — Khmer NiDA Typing Trainer

Audit performed against `docs/SECURITY-REVIEW-AUDIT.md` on 2026-08-18, branch
`phase-6-ship` at `febab1e`.

Every command below was actually run; output is quoted verbatim or summarised
with its count. Where a check needed a browser or a deployed URL, it is marked
`NEEDS-HUMAN` rather than guessed at.

**Headline:** the application code is clean — no exfiltration path exists *today*
and no keyboard listener escapes the input element. What is missing is the layer
that keeps that true: there is **no CSP at all**, so nothing constrains where a
compromised dependency could send the keystroke table. Two further findings
contradict claims made in `SECURITY-REVIEW.md` about controls that were said to
be in place.

---

## F-01 · CRITICAL · No Content-Security-Policy is served — `connect-src` absent entirely

```
Location:  netlify.toml:9-12 (comment forbidding a headers block)
           public/_headers — does not exist
           dist/_headers   — does not exist
```

**Evidence**

```bash
$ find . -name "_headers" -not -path "./node_modules/*"
(no output)

$ ls -la dist/_headers
MISSING: no dist/_headers

$ cat netlify.toml
[build] / [[redirects]] only — no [[headers]] block
```

`netlify.toml` ends with:

> `# No headers block: storage uses the opfs-sahpool VFS specifically because it`
> `# needs no COOP/COEP cross-origin isolation headers. Don't add one.`

That comment conflates two unrelated things. Skipping **COOP/COEP** is correct
and deliberate — sahpool needs no cross-origin isolation. But CSP,
`X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are
independent of it, and the comment reads as an instruction not to add them. The
result is that the single most important control in `SECURITY-REVIEW.md` §9 was
never shipped.

**Impact.** The built bundle already contains generic network primitives — 24
`fetch`/`XMLHttpRequest` occurrences across `dist/` (all currently benign, see
*Verified present*). Nothing at the response-header layer prevents any of them,
or any code a future compromised dependency injects, from opening a connection
to an arbitrary origin. The database holds `ms_since_prev` per keystroke, which
`SECURITY-REVIEW.md` §3 correctly identifies as biometric. This is the finding
the review itself called *"the single directive that does more for §1 than
anything else on the list."*

**Fix.** Create `public/_headers` — inside `public/`, so Vite copies it into
`dist/`; a root-level `_headers` is silently ignored by Netlify — carrying the
§9 header set. Keep COOP/COEP out, and rewrite the `netlify.toml` comment so it
says what it means: no COOP/COEP, CSP still required.

**Status: FIXED** — `public/_headers` carries the full §9 header set
(`connect-src 'self'`, `wasm-unsafe-eval`, `worker-src 'self' blob:`, etc.) and
ships into `dist/` on build. `netlify.toml`'s comment now says what it means:
COOP/COEP deliberately absent, CSP required and present in `public/_headers`.

---

## F-02 · HIGH · Raw `.sqlite` import is implemented, against the agreed design

```
Location:  src/DataPanel.tsx:88-100   (file input, accept list)
           src/DataPanel.tsx:63-75    (onImport)
           src/storage/db.ts:145-153  (importDatabase)
           src/storage/db.worker.ts:127-139 (pool.importDb)
           src/storage/schema.ts:174-176 (looksLikeSqlite)
```

**Evidence.** The file input accepts:

```tsx
accept=".sqlite3,.sqlite,.db,application/vnd.sqlite3"
```

The only validation before the file reaches the SQLite parser is a 16-byte magic
check:

```ts
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}
```

The worker then hands the bytes straight to the VFS and reopens against them:

```ts
db.close();
try { await pool.importDb(DB_FILENAME, bytes); }
finally { openDatabase(); }   // runs PRAGMAs and migrations against the new file
```

**Impact.** `SECURITY-REVIEW.md` §7 and audit §0.5 both specify **export
`.sqlite`, import JSON** precisely to remove the SQLite parser from the attack
surface. The implemented path does the opposite: an attacker-supplied file is
parsed by SQLite-WASM and then becomes the live database, with `openDatabase()`
running `PRAGMA foreign_keys = ON` and the migration chain against it. A magic
header is trivially forged and validates nothing about the contents. There is
also no file-size cap, no row cap, no schema validation, and no throwaway
read-only connection — every mitigation §7 lists for the "if you must accept
`.sqlite`" case is absent too.

**Fix.** Switch import to JSON (export may stay `.sqlite3`). If `.sqlite` import
is kept, implement §7's full fallback: read-only throwaway connection, schema
validation, row copy into a fresh database, size and row caps.

**Status: FIXED** — `src/DataPanel.tsx` now exports `.sqlite3` but imports only
`.json` (`accept=".json,application/json"`); the raw-`.sqlite` import path and
its `looksLikeSqlite` magic-byte check are gone, removing the SQLite-WASM parser
from the attack surface entirely rather than hardening it.

---

## F-03 · HIGH · The typing input is `sr-only` and `autoFocus` — the opposite of what §10 claims

```
Location:  src/keyboard/KeyboardInput.tsx:40 (autoFocus)
           src/keyboard/KeyboardInput.tsx:49 (className="sr-only")
           src/keyboard/KeyboardInput.tsx:10 (doc comment)
```

**Evidence**

```tsx
/**
 * The typing surface: a visually hidden but focusable `<input>`.
 */
...
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole page is this field
        autoFocus
        onKeyDown={handleKeyDown}
...
        className="sr-only"
```

**Impact.** Audit §2.4 states plainly: *"If you find the input is hidden,
offscreen, zero-sized, or `opacity: 0`, that is **HIGH**"*, and requires *"no
`autoFocus` on the typing input."* Both conditions are violated. `sr-only` is
the Tailwind visually-hidden utility — the element is a 1px clipped box.
Combined with `autoFocus`, the app begins capturing keystrokes on page load into
an element the user cannot see.

This directly contradicts `SECURITY-REVIEW.md` §10, which is titled *"LOW
(resolved by design)"* and asserts the hidden input *"was"* replaced by a visible
click-to-focus field. It was not. It also violates the `CLAUDE.md` hard rule:
*"The input is visible and click-to-focus; never autofocus it. This is a privacy
property, not a UX preference."*

Partial mitigation, worth stating fairly: the **wrapper div** is visible and does
change border colour on focus (`focused ? 'border-caret bg-surface' : …`), and
shows "Click here, or Tab to it, to start typing." when unfocused. So there is
*some* visible recording indicator. But the input itself is hidden and
autofocused, which is the specific property the audit tests for.

**Fix.** Make the input a real visible element (or at minimum remove
`autoFocus`), so capture begins only on a deliberate user action.

**Status: FIXED** — `src/keyboard/KeyboardInput.tsx` is now a real, visible,
click-to-focus `<input>` (no `sr-only`, no `autoFocus`); the doc comment
explains why. `SECURITY-REVIEW.md` §10 has been corrected to state this was
fixed, rather than asserting it was already true.

---

## F-04 · HIGH · No `.npmrc`; install scripts run unrestricted

```
Location:  repository root — .npmrc does not exist
```

**Evidence**

```bash
$ cat .npmrc
NO .npmrc
```

**Impact.** `SECURITY-REVIEW.md` §1 calls supply chain *"the dominant risk"* and
`ignore-scripts=true` its cheapest control. Without it, `npm install` executes
postinstall scripts from any of the packages in the tree with the developer's
full user permissions. The lockfile carries 515 `resolved` entries.

**Fix.** `echo "ignore-scripts=true" > .npmrc`, then verify the build still
works — re-enable per-package only with a recorded reason.

**Status: FIXED** — `.npmrc` now sets `ignore-scripts=true`, with a comment
recording why. No package has been re-enabled.

---

## F-05 · MEDIUM · `react/no-danger` is not enforced — ESLint is not installed at all

```
Location:  package.json — no lint script, no eslint dependency
           repository root — no eslint config of any kind
```

**Evidence**

```bash
$ ls -la .eslintrc* eslint.config* 2>/dev/null
NO ESLINT CONFIG

$ grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|eval(\|new Function\|document.write" src/
(no output — 0 hits)
```

`npm run lint` could not be run because the script does not exist.

**Impact.** The current code is clean — that part is genuinely fine. But the
*control* the review asked for is absent, so nothing stops the next
`dangerouslySetInnerHTML` from landing. Audit §1.2 puts it exactly right: *"A
rule configured but never executed is not a control."* Here it was never even
configured.

Corroborating detail: `KeyboardInput.tsx:39` carries
`// eslint-disable-next-line jsx-a11y/no-autofocus` — a suppression comment for a
linter that has never been installed. The rule was assumed, not run. That same
line is where F-03 lives, which is the concrete cost of the missing control.

**Fix.** Add ESLint with `react/no-danger: error`, a `lint` script, and run it in
CI.

**Status: FIXED** — `eslint.config.js` registers `eslint-plugin-react` with
`react/no-danger: 'error'` over `src/**/*.tsx`, `npm run lint` is a real script,
and the rule was verified to actually fire (and clear again) against a
deliberately introduced `dangerouslySetInnerHTML`, not just configured. CI
wiring itself is out of scope here — `.github/workflows/` still does not exist
(see F-08).

---

## F-06 · MEDIUM · There is no "Clear all my data"

```
Location:  src/DataPanel.tsx — export and import only
```

**Evidence.** A search across `src/` for `clearAll|DELETE FROM|removeVfs|wipeFiles|unlink|clear`
returns only `clearTimeout`/`clearInterval`/`pending.clear()` and one
`DELETE FROM sessions` inside `src/storage/schema.test.ts:133`. No deletion path
exists in application code.

**Impact.** `SECURITY-REVIEW.md` §3 requires a button that *drops the OPFS
database*, not one that runs `DELETE FROM`. Neither exists. `README.md:134-148`
tells the user their keystroke data is stored locally and describes export and
import, but offers no way to remove it. For data the review correctly classifies
as biometric, "you can't delete it" is the weaker half of the promise.

**Fix.** Add a confirm-gated control that closes the connection and removes the
OPFS database file via the sahpool VFS (`pool.wipeFiles()` / `removeVfs()`),
not a table-level delete.

**Status: FIXED** — `src/DataPanel.tsx` has a confirm-gated "Clear all my data"
button (`onClear`) wired to a new `clearAllData()` in `src/storage/index.ts`.
Whether it actually removes the OPFS file rather than just emptying it still
needs a browser check — see *Could not verify* below, unchanged by this fix.

---

## F-07 · MEDIUM · Full-resolution keystroke timing stored indefinitely; no retention policy

```
Location:  src/storage/schema.ts:39-46 (keystrokes table)
           src/storage/db.worker.ts:96-127 (saveSession insert path)
```

**Evidence.** The schema stores, per keystroke:

```sql
CREATE TABLE IF NOT EXISTS keystrokes (
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_codepoint TEXT,
  typed_codepoint  TEXT    NOT NULL,
  correct          INTEGER NOT NULL,
  ms_since_prev    INTEGER NOT NULL
);
```

plus `target_cluster` and `subscript` from migration v2. `ms_since_prev` is
millisecond flight time.

**There is no code anywhere that deletes old rows.** No rollup, no aggregation
step, no age-based pruning. `MIGRATIONS` only ever adds. The only deletion in
the entire codebase is `ON DELETE CASCADE`, which fires only if a session row is
removed — and nothing removes session rows.

**Impact.** This is precisely the dataset §3 identifies as biometric, retained
forever. It also guarantees F-09's quota problem eventually.

**Fix.** Implement §3's policy: keep raw rows ~30 days, roll up into per-cluster
aggregates, delete the raw rows. Both problems close together.

---

## F-08 · MEDIUM · No corpus validator, no CI, and `stripInvisible()` does not strip bidi controls

```
Location:  scripts/ — does not exist
           .github/workflows/ — does not exist
           src/khmer/segment.ts:43-45 (stripInvisible)
```

**Evidence**

```bash
$ ls -la scripts/
NO scripts/ DIRECTORY
$ ls -la .github/workflows/
NO .github/ DIRECTORY
```

`stripInvisible()` removes exactly one codepoint:

```ts
export function stripInvisible(text: string): string {
  return text.replaceAll('​', '');
}
```

Its doc comment is explicit that ZWNJ/ZWJ are deliberately preserved because
they change Khmer ligature rendering — that reasoning is sound and should not be
undone. But it means bidi controls `U+202A`–`U+202E`, `U+2066`–`U+2069` and
`U+200E`/`U+200F` pass through untouched into both the rendered passage and the
codepoint comparison.

**The shipped corpus is clean** — see *Verified present*. This is a missing gate,
not a live defect.

**One correction to the audit's own method.** Audit §3.2's byte-level grep cannot
detect this class of problem in this repo:

```bash
$ grep -lP "[\x{202A}-\x{202E}\x{2066}-\x{2069}\x{200B}\x{200E}\x{200F}]" public/corpus/*.json
(no match, exit 1)

$ grep -oE '\\u[0-9a-fA-F]{4}' public/corpus/placeholder.json | sort | uniq -c
     59 u200b
      2 u200B
```

The corpus contains 61 zero-width spaces, deliberately, as word-boundary markers
— written as JSON `​` escapes so they are visible in a diff. A raw grep sees
none of them. Any validator must run **after** `JSON.parse`, on the decoded
strings. A future corpus could carry bidi overrides in escaped form and pass
§3.2 cleanly.

**Fix.** Write `scripts/validate-corpus.ts` operating on parsed strings with the
§5 allowlist, and run it in CI. Keep ZWSP permitted (it is load-bearing here) but
reject bidi controls outright.

---

## F-09 · MEDIUM · No storage-quota handling

```
Location:  src/storage/ — navigator.storage.estimate() never called
```

**Evidence.** A search of `src/` for `storage.estimate|StorageManager|QuotaExceeded|quota`
returns **no matches**.

**Impact.** §11 requires a startup estimate and graceful degradation. Neither
exists.

Partial mitigation, stated fairly: `db.ts` has an `'unavailable'` status that
catches worker start-up failure, and `DataPanel.tsx:129` surfaces *"Database
unavailable… Your results will not be saved."* So a hard failure at connect time
does degrade correctly. But a quota error raised during `saveSession` — the
realistic case, given F-07 guarantees unbounded growth — is caught only by the
generic worker error handler and shown to the user as a raw SQLite message.

**Fix.** Call `navigator.storage.estimate()` at init, warn before the ceiling,
and give quota failures a distinct, plain-language path.

---

## F-10 · MEDIUM · No service-worker kill-switch, and no evidence of a rollback test

```
Location:  vite.config.ts:11-14 — VitePWA config; no kill-switch SW anywhere
```

**Evidence.** The good parts first, since they check out:

```bash
$ grep -oE "skipWaiting|clientsClaim" dist/sw.js | sort | uniq -c
      1 clientsClaim
      1 skipWaiting

$ grep -oE '"revision":null' dist/sw.js | wc -l
0
```

`registerType: 'autoUpdate'` produces both directives, and every precache entry
carries either an md5 revision (`index.html`, `registerSW.js`, `icon.svg`,
`corpus/placeholder.json`) or a content-hashed filename. §6's caching and update
requirements are met.

**What is missing** is the kill-switch: no self-unregistering service worker
exists in the repo, and there is nothing in the git history or docs indicating a
rollback has been rehearsed. §6 is explicit that this must be built and proven
*before* it is needed.

**Fix.** Write a kill-switch SW that unregisters itself and clears caches, and
test it on a real device once.

---

## F-11 · LOW · `onBlur` does not pause the test

```
Location:  src/keyboard/KeyboardInput.tsx:45
           src/typing/TypingTest.tsx:120-127 (timer)
```

**Evidence**

```tsx
onBlur={() => setFocused(false)}
```

That is the only blur handling in the codebase — it flips a styling boolean. The
timed-test `setTimeout` in `TypingTest.tsx` is keyed on `[phase, config]` and
keeps running regardless of focus.

**Impact.** Audit §2.4 requires *"`onBlur` pauses the test rather than continuing
to time."* It does not. The practical cost is result accuracy rather than
privacy, but it is a listed requirement and it is unmet.

**Status: FIXED** — `KeyboardInput` now takes `onBlur`/`onFocus` callbacks;
`TypingTest.tsx` uses them to set `paused` and accumulate `Stats.pausedMs`,
which is subtracted out of `finalScore()`, the saved `durationMs`, and the live
stats via the shared `elapsedMs()` helper in `src/typing/engine.ts` (covered by
a regression test in `engine.test.ts`).

---

## F-12 · LOW · Password-manager attributes absent from the input

```
Location:  src/keyboard/KeyboardInput.tsx:41-50
```

**Evidence.** The input sets `autoComplete`, `autoCorrect`, `autoCapitalize`,
`spellCheck` — but neither `data-1p-ignore` nor `data-lpignore="true"`, both of
which §10 and audit §2.4 require.

**Status: FIXED** — the input in `KeyboardInput.tsx` now carries both
`data-1p-ignore` and `data-lpignore="true"`, with a comment on why.

---

## F-13 · LOW · `.netlify/` not ignored

```
Location:  .gitignore
```

**Evidence.** `.gitignore` contains `node_modules`, `dist`, `dist-ssr`,
`*.local`, `.DS_Store` — no `.netlify/`. §2 asks for it so a Netlify auth token
cannot be committed by accident.

**Status: FIXED** — `.gitignore` now includes `.netlify/`.

---

## F-14 · LOW (informational) · One template literal reaches a SQL string

```
Location:  src/storage/db.worker.ts:79
```

**Evidence**

```ts
// PRAGMA takes no bound parameters. `step.version` is a loop index we
// generated, never anything from outside.
db.exec(`PRAGMA user_version = ${step.version}`);
```

**Assessment: not exploitable.** `step.version` is computed in
`schema.ts:pendingMigrations()` as `Math.max(0, userVersion) + i + 1` — an
integer derived from a loop index, never from user input, and PRAGMA genuinely
cannot take bound parameters. Recorded only because audit §1.3 asks for every
template literal reaching SQL to be reported. Every other statement in the
codebase uses bound parameters.

---

## F-15 · LOW · No corpus licence or attribution file

```
Location:  public/corpus/ — contains only placeholder.json
```

**Evidence**

```bash
$ ls -la public/corpus/
placeholder.json    (only file)
```

Every entry currently declares `"source": "placeholder"`, so no third-party text
is shipped and there is no live licensing problem. §5 requires
`public/corpus/LICENSE` with CC BY-SA attribution before real Khmer Wikipedia
text lands — worth creating now, while the corpus is still empty.

---

# 1. Verified present

Controls confirmed working, each with the command that confirmed it.

**No exfiltration path in the built bundle.** 24 network-API occurrences across
`dist/`, every one accounted for:

```bash
$ grep -roE "fetch\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource|navigator\.connection" dist/ | wc -l
24
```

Broken down: 5 in `workbox-*.js` (precache handling), 8 in
`sqlite3-worker1-*.js` and 7 in `db.worker-*.js` (Emscripten WASM loading,
`credentials:"same-origin"`), 2 in `index-*.js` — one Vite modulepreload, one the
corpus load. Inspecting the corpus call in the shipped bundle:

```js
async function Wd(a="/corpus/placeholder.json"){const p=await fetch(a); …}
```

Relative, same-origin, hardcoded at build time. **No absolute or non-same-origin
URL in any of the 24.** `sendBeacon`, `WebSocket`, `EventSource`,
`navigator.connection`: zero occurrences.

**No third-party origins in shipped output.**

```bash
$ grep -ohE "https?://[^\"')]+" dist/index.html dist/assets/*.js dist/sw.js dist/*.js | sort -u
```

Returns 15 strings, all inert: W3C XML namespaces (`w3.org/2000/svg` etc.),
Emscripten/SQLite licence text, React's error-decoder URL, and documentation
links inside comments. No analytics, no CDN, no Google Fonts. The Khmer font is
self-hosted and bundled (`dist/assets/noto-sans-khmer-*.woff2`, 3 files).

**No keyboard listener outside the input element.**

```bash
$ grep -rn "addEventListener(['\"]key\|onKeyDown\|onKeyPress\|onKeyUp" src/
src/keyboard/KeyboardInput.tsx:43:        onKeyDown={handleKeyDown}

$ grep -rn "document.addEventListener\|window.addEventListener" src/
(no output)
```

Exactly one keyboard handler, bound to the input. Zero listeners on `document`
or `window`. The `CLAUDE.md` hard rule holds. (The input's *visibility* does not
— see F-03.)

**No HTML-injection surface.** `grep` for
`dangerouslySetInnerHTML|innerHTML|outerHTML|eval(|new Function|document.write`
across `src/` → 0 hits. Per-character colouring is built from React elements in
`src/typing/Word.tsx`.

**Lockfile integrity.**

```bash
$ grep -o '"resolved": "[^"]*"' package-lock.json | grep -v 'registry.npmjs.org' | sort -u
(no output)
$ grep -c '"resolved"' package-lock.json
515
```

All 515 resolved URLs point at `registry.npmjs.org`. No git or tarball URLs.

**Dependency audit clean.**

```bash
$ npm audit --omit=dev
found 0 vulnerabilities
```

**No unauthorised dependencies.** `package.json` was diffed against `SPEC.md:11-19`
("Stack (fixed — do not substitute)"). Every one of the 14 packages maps to a
spec line: Vite, React 18 + TypeScript, Tailwind (`@tailwindcss/vite`), Zustand,
`@sqlite.org/sqlite-wasm`, `vite-plugin-pwa`, Vitest,
`@fontsource-variable/noto-sans-khmer`, plus type packages and
`@vitejs/plugin-react`. **Nothing present that the spec did not authorise.**
Production tree is 19 lines from `npm ls --all --omit=dev`.

**Bound parameters throughout, enforced by the type system.** `WorkerOp`
(`db.worker.ts:29-37`) is a closed discriminated union — eight operations, each
with typed scalar fields, and **no field anywhere carries a SQL string**. A
caller physically cannot pass a raw query across the worker boundary. This is the
type signature audit §1.3 asked to see. All SQL text is a module constant in
`schema.ts`/`analytics.ts` with `?` or `$name` placeholders; the sole exception is
the PRAGMA at F-14.

**Shipped corpus is free of bidi controls.**

```bash
$ grep -oP "[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}]" public/corpus/placeholder.json
(no output)
```

Confirmed clean both raw and, by inspection of the 61 `​` escapes, decoded:
the only invisible present is ZWSP, deliberately, as a word-boundary marker.

**Service-worker caching hygiene.** `skipWaiting` and `clientsClaim` both present
in `dist/sw.js`; all 15 precache entries versioned (0 `"revision":null`).

**Build and tests pass.**

```bash
$ npm run build   # tsc --noEmit && vite build → ✓ built in 2.98s, 45 modules
$ npm test        # Test Files 7 passed (7) · Tests 188 passed (188)
```

**Settings input treated as untrusted.** `storage/index.ts:loadSettings()`
field-validates parsed `localStorage` rather than casting, and catches both
access and parse failures. Corpus parsing (`corpus/index.ts:parseCorpus`)
likewise validates each entry and skips bad ones.

---

# 2. Could not verify

- **Live CSP headers on the deployed site.** No deploy URL is recorded in the
  repo, and F-01 makes the check moot — there is no header configuration to
  serve. `NEEDS-HUMAN`: after F-01 is fixed, run
  `curl -sI https://<site>.netlify.app/ | grep -iE "content-security-policy|x-content-type|referrer-policy|permissions-policy"`
  and confirm `connect-src 'self'` appears. Note that `npm run preview` does
  **not** apply Netlify headers, so this must be checked against the real deploy.
- **Live network check (audit §0.4).** `NEEDS-HUMAN`: open the deployed site,
  DevTools → Network, complete a full typing test, view results, export data.
  Expected outbound requests after initial load: **zero**. The static analysis
  above predicts zero but cannot prove runtime behaviour.
- **CSP compatibility with SQLite-WASM.** `'wasm-unsafe-eval'` and possibly
  `worker-src blob:` will be required. Must be verified against `npm run preview`
  and the live deploy once F-01 lands — the build emits an ES-module worker plus
  a separate Emscripten proxy script.
- **Service-worker update and kill-switch behaviour on a real device.** Cannot be
  driven from here.
- **Khmer glyph rendering.** Per `CLAUDE.md`, terminal output is unreliable for
  stacked glyphs; browser verification required.
- **Whether OPFS deletion actually removes the file** once F-06 is implemented —
  needs a browser to confirm the sahpool file is gone, not just emptied.

**Out of scope — flagged for the human, status unknown and not guessed at:**

- 2FA on GitHub and Netlify
- Branch protection on `main` (this audit ran on `phase-6-ship`, unmerged)
- Netlify deploy keys and third-party GitHub app authorisations
- Whether a rollback has ever been rehearsed

---

# 3. Recommended fix order

Ranked by exploitability and cost, not by severity label.

| # | Finding | Why here |
|---|---------|----------|
| 1 | **F-01** CSP `_headers` | One new file. Closes the only real exfiltration channel and is the control every other supply-chain risk falls back on. Highest value per minute of work in the entire list. |
| 2 | **F-04** `.npmrc ignore-scripts` | One line. Closes the most common supply-chain execution path. |
| 3 | **F-02** import → JSON | Removes an attacker-reachable parser entirely rather than defending it. Deleting the `.sqlite` path is less work than hardening it. |
| 4 | **F-03** visible input, no `autoFocus` | Small, local edit; the app currently captures keystrokes into a hidden field from page load, and both the review and `CLAUDE.md` say it must not. Do **F-11** and **F-12** in the same file at the same time. |
| 5 | **F-06** clear-all-data | The README already promises local-only data; the ability to delete it is the missing half. Moderate effort, high user-facing value. |
| 6 | **F-05** ESLint + `react/no-danger` | Cheap. Prevents regression of a class of bug the code is currently free of — and would have caught F-03's suppressed rule. |
| 7 | **F-08** corpus validator + CI | Must land **before** the real Khmer Wikipedia corpus arrives, or it validates nothing retroactively. Remember: operate on parsed strings, not raw bytes. |
| 8 | **F-07** retention policy | Larger change (rollup schema + migration). Closes F-09's root cause at the same time. |
| 9 | **F-09** quota handling | Partly mitigated already; finish it alongside F-07. |
| 10 | **F-10** SW kill-switch | Only matters after a bad deploy — but by then it is too late to write. Build and test once, before launch. |
| 11 | **F-13**, **F-15** | Two-minute hygiene items. Fold into any of the above. |

**One documentation fix belongs with these:** `SECURITY-REVIEW.md` §10 states the
hidden-input problem is *"resolved by design."* F-03 shows it is not. A review
document that certifies a control which was never implemented is worse than
silence, because it stops anyone from looking. Correct §10 when F-03 is fixed —
and treat this as the practical demonstration of the audit's own rule 4: the
memory of a decision is not evidence it landed in the file.

---

## Honest limits of this pass

This audit is static. It confirms that no exfiltration path exists in the source
and in the current build output; it cannot prove none appears at runtime, and it
would not catch a well-executed supply-chain attack that hides behind a
legitimate-looking asset fetch. F-01 is the finding that matters most precisely
because it is the control that keeps holding when this kind of analysis stops
being sufficient.
