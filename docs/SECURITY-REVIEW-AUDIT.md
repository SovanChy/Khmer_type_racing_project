# Security Audit — Khmer NiDA Typing Trainer

You are auditing a finished codebase, not writing one. Assume it is broken until
the code proves otherwise.

Context that determines priority: **this application records every keystroke a
user makes, with millisecond timing.** That is its legitimate purpose. It also
means any code-integrity failure hands an attacker a working keylogger with a
plausible cover story. Prioritise accordingly — exfiltration paths outrank
everything else in this document.

`SECURITY-REVIEW.md` in this repo lists what *should* be true. Your job is to
determine what *is* true. Do not treat that document as evidence of anything.

---

## Rules of engagement

1. **Do not fix anything during this pass.** No edits, no refactors, no
   "while I was here." Produce the report first. Fixes happen in a separate
   session against the finished report.
2. **Every finding needs evidence.** A file path and line number, or the command
   you ran and its actual output. "This appears to be handled correctly" is not
   a finding — it's a guess. If you did not run the command, say so.
3. **Report what you could not check.** A gap you name is useful. A gap you
   paper over is a vulnerability.
4. **You wrote most of this code.** Treat that as a reason for suspicion, not
   confidence. Where you recall making a decision, verify the decision actually
   landed in the file rather than trusting the memory.
5. Where a check needs a running browser or a deployed URL and you cannot reach
   one, write the exact steps for a human and mark it `NEEDS-HUMAN`.

---

## Priority 0 — Can keystroke data leave the device?

Everything else is secondary. Work through all six.

**0.1 — Grep the built bundle, not the source.**

```bash
npm run build
grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource|navigator\.connection" dist/
```

List every hit with its surrounding context. Each one must be explainable as
same-origin asset loading. Anything pointing at an absolute URL or a
non-same-origin host is a **CRITICAL** finding. Report the count even if zero.

**0.2 — Is the CSP actually being served?**

The `_headers` file must be inside `public/` so Vite copies it into `dist/`. A
`_headers` file sitting in the project root is silently ignored by Netlify. Check:

```bash
ls -la dist/_headers && cat dist/_headers
```

Then verify against the live deploy, because `vite preview` does not apply
Netlify headers:

```bash
curl -sI https://<your-site>.netlify.app/ | grep -iE "content-security-policy|x-content-type|referrer-policy|permissions-policy"
```

If `connect-src` is missing, absent, or set to anything broader than `'self'`,
that is **CRITICAL** — it is the single control standing between a compromised
dependency and a keystroke feed.

**0.3 — Third-party origins in the shipped HTML.**

```bash
grep -oE "https?://[^\"')]+" dist/index.html dist/assets/*.js | sort -u
```

Every external origin is a finding. Fonts must be self-hosted. There should be
no analytics, no CDN script tags, no Google Fonts.

**0.4 — Live network check.** `NEEDS-HUMAN` if you cannot drive a browser.

Open the deployed site, DevTools → Network, filter by domain, complete a full
typing test, view results, export data. Expected outbound request count after
initial load: **zero**. Write down anything that appears.

**0.5 — Import path.**

Does the app accept a `.sqlite` file? Locate the import handler and report its
accepted MIME types and extensions. If raw SQLite import exists, that is **HIGH**
— the agreed design is export `.sqlite`, import JSON only.

**0.6 — What is actually stored.**

Find the schema and the insert path for keystroke data. Report: is
per-keystroke timing stored at full resolution, and is there any retention or
rollup policy in code? Show the code that deletes old rows. If none exists, say
so plainly.

---

## Priority 1 — Code integrity

**1.1 Supply chain.**

```bash
cat .npmrc
npm audit --omit=dev
npm ls --all --omit=dev | wc -l
```

Report: is `ignore-scripts=true` set; the audit result verbatim; the production
dependency count. Then diff `package.json` against the dependency list in
`SPEC.md` and name every package present that the spec did not authorise.

Check the lockfile for `resolved` URLs that do not point at
`registry.npmjs.org`. Any that do not are **HIGH**.

**1.2 Injection surface.**

```bash
grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|eval(\|new Function\|document.write" src/
```

Any hit in rendering code is **HIGH**. Then confirm `react/no-danger` is set to
`error` in the ESLint config, and that `npm run lint` actually runs it — run it
and paste the output. A rule configured but never executed is not a control.

**1.3 SQL construction.**

```bash
grep -rnE "exec\(\`|prepare\(\`|run\(\`|\\\$\{.*\}" src/storage/ src/db/ 2>/dev/null
```

Every query must use bound parameters. Report any template literal reaching a
SQL string. Confirm callers cannot pass a raw query string through the worker
boundary — show the type signature that prevents it, or report that nothing does.

---

## Priority 2 — Persistence and lifecycle

**2.1 Service worker.** Locate the kill-switch. Report whether one exists, and
whether there is any evidence it has been tested. Check that precached assets
carry content hashes, and that `skipWaiting` and `clientsClaim` are configured.
An untested kill-switch is a finding — a bad deploy caches indefinitely.

**2.2 Data deletion.** Find "clear all my data." Determine whether it drops the
OPFS database file or only runs `DELETE FROM`. If the latter, that is a **MEDIUM**
— the row data is still recoverable in the file and the user was told otherwise.

**2.3 Storage quota.** Show the error path when OPFS is full. The app must
degrade to "results not saved," not fail to load. If `navigator.storage.estimate()`
is never called, report it.

**2.4 Input capture scope.** The design binds keyboard handling to a single
visible input element. Verify mechanically rather than by reading the lifecycle:

```bash
grep -rn "addEventListener(['\"]key\|onKeyDown\|onKeyPress\|onKeyUp" src/
grep -rn "document.addEventListener\|window.addEventListener" src/
```

Any keyboard listener on `document` or `window` is a **HIGH** finding by
definition — it captures outside the input's focus scope, which is the property
the whole design rests on. Report every hit with its file and line.

Then confirm three things and paste the line that proves each:

- No `autoFocus` on the typing input, and no `.focus()` call on mount.
- `onBlur` pauses the test rather than continuing to time.
- `data-1p-ignore` and `data-lpignore` are present on the input.

If you find the input is hidden, offscreen, zero-sized, or `opacity: 0`, that is
**HIGH** — the design requires the user to be able to see when recording is
active.

---

## Priority 3 — Content and corpus

**3.1** Run the corpus validator against every shipped corpus file and paste the
output. If no validator exists, or it does not run in CI, that is a finding.

**3.2** Scan the shipped corpus for bidi controls and invisibles directly:

```bash
grep -lP "[\x{202A}-\x{202E}\x{2066}-\x{2069}\x{200B}\x{200E}\x{200F}]" public/corpus/*.json
```

Any match is **MEDIUM** — bidi overrides make displayed text differ from logical
order, so the user is graded against something other than what they see.

**3.3** Confirm corpus attribution and licence files are present and accurate.

---

## Out of scope for you — flag for the human

State these plainly in the report as unverifiable from the codebase. Do not
guess at their status:

- 2FA on GitHub and Netlify
- Branch protection on `main`
- Netlify deploy keys and third-party GitHub app authorisations
- Whether a rollback has ever been rehearsed

---

## Report format

Write findings to `SECURITY-AUDIT-FINDINGS.md`. One entry each:

```
### F-01 · CRITICAL · connect-src missing from deployed CSP
Location:  public/_headers:3
Evidence:  curl -sI https://…  → no Content-Security-Policy header returned
Impact:    A compromised dependency can POST the keystroke buffer anywhere.
Fix:       Add connect-src 'self'; confirm _headers ships inside dist/.
```

Severity: CRITICAL (keystroke data can leave the device, or arbitrary code can
run) · HIGH (plausible path to either) · MEDIUM (weakens a control) · LOW
(hardening).

Close the report with three sections, in this order:

1. **Verified present** — controls you confirmed working, each with the command
   that confirmed it.
2. **Could not verify** — what you could not reach and why.
3. **Recommended fix order** — findings ranked by exploitability, not by severity
   label. Cheap fixes that close real paths go above expensive fixes that close
   theoretical ones.

Then stop. Do not begin fixing.

---

## One honest limit

This audit catches configuration drift, missing controls, and the mistakes that
accumulate across six build phases. It does not catch a well-executed supply
chain attack, and it is not a substitute for a security review by a person.

For an app that collects keystrokes, the controls that actually carry the weight
are mechanical and cheap: `connect-src 'self'`, zero outbound requests in the
built bundle, and no third-party origins in the shipped HTML. If you verify
nothing else in this document, verify Priority 0.