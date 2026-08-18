# Security Review — Khmer NiDA Typing Trainer

Pre-launch review for a static, backend-less React + SQLite-WASM typing trainer
deployed to Netlify.

---

## Threat model

**What we're protecting:** the integrity of the code served to users, and a
local store of keystroke data (target codepoint, typed codepoint, timing).

**What we are not protecting:** there is no server, no auth, no accounts, no
payment data, no PII collection, and no user-to-user interaction. Whole classes
of vulnerability are structurally absent — CSRF, IDOR, session fixation, SQL
injection against a shared database, SSRF, server-side RCE. Do not spend time on
them.

**The one thing that makes this app unusual:** it legitimately captures every
keystroke. Malicious code injected into this app doesn't need to *build* a
keylogger — it inherits one, plus a plausible reason for the data to exist. That
raises the impact of any code-integrity failure well above what a static site
would normally carry.

Severity below is **impact if exploited × realistic likelihood** for this
specific project.

---

## 1. Supply chain compromise — HIGH

The dominant risk. Vite + React + Tailwind + sqlite-wasm + vite-plugin-pwa pulls
in hundreds of transitive packages. `npm install` executes postinstall scripts
with your user's permissions. A single compromised package can inject an
exfiltration call into the build output, and you will not notice it by reading
your own source.

**Mitigations**

- Commit `package-lock.json`. Use `npm ci`, never `npm install`, in CI and deploy.
- Set `ignore-scripts=true` in `.npmrc`. Re-enable per-package only if something
  genuinely needs a postinstall step, and note why.
- Run `npm audit --omit=dev` before each deploy. Enable Dependabot or Renovate,
  but **read the lockfile diff** on updates rather than auto-merging.
- Keep the dependency list short. Every package added is attack surface — this
  is the real reason the spec requires justification for new deps.
- Prefer packages with few transitive deps. Check `npm ls --all | wc -l` after
  each addition; a sudden jump is worth investigating.

---

## 2. Deploy pipeline compromise — HIGH

A stolen GitHub or Netlify credential lets an attacker serve arbitrary JS from
your trusted origin. The service worker then caches it, so the malicious version
persists on user devices even after you push a fix.

**Mitigations**

- Hardware or app-based 2FA on both GitHub and Netlify. Not SMS.
- Protect `main`. Require PRs even as a solo developer — it gives you a diff to
  review and an audit trail.
- Audit Netlify deploy keys and any third-party GitHub app authorisations; remove
  what you don't use.
- Never commit a Netlify auth token. Add `.netlify/` to `.gitignore`.
- Keep a documented rollback: Netlify's "publish previous deploy" plus a service
  worker kill-switch (see §6).

---

## 3. Keystroke data is biometric — MEDIUM

Keystroke dynamics — dwell time and flight time between keys — identify
individuals with meaningful accuracy. Your `keystrokes` table with
`ms_since_prev` is exactly this data. It is fine sitting in OPFS on one device.
It becomes a real disclosure the moment it leaves.

**Mitigations**

- State plainly in the UI that all data stays on the device. It's true, it's a
  feature, and it sets the expectation you'll have to honour later.
- Apply a retention policy: keep raw per-keystroke rows for ~30 days, then roll
  up into per-cluster aggregates and delete the raw rows. This also solves the
  quota problem in §8.
- Ship a **Clear all my data** button that actually drops the OPFS database, not
  just the table rows.
- If you ever add sync, leaderboards, or sharing, treat that as a new product
  with a real privacy policy. Do not let it arrive incrementally.
- OPFS is **not encrypted at rest**. On a shared machine — a lab, a school, an
  internet café — anyone with access to the same OS account can read the browser
  profile. Worth a line in the README and worth thinking about if this is aimed
  at classroom use.

---

## 4. XSS through per-character rendering — MEDIUM

React escapes by default, so this is only reachable if you defeat it. The
temptation is specific and predictable: per-character colouring feels like it
wants `dangerouslySetInnerHTML` with a built-up HTML string.

**Mitigations**

- **Never use `dangerouslySetInnerHTML` in this project.** Build every
  highlight span as a React element. Add an ESLint rule
  (`react/no-danger: error`) so this is enforced, not remembered.
- Corpus JSON must be same-origin and bundled. Do not fetch corpus text from a
  remote URL — that turns a static asset into a live injection channel.
- If you add a "paste your own text" mode, it stays a plain string passed as a
  React child. Never as markup.

---

## 5. Untrusted corpus content — MEDIUM

You're sourcing Khmer text from Wikipedia. Wiki text can contain bidi control
characters (`U+202A`–`U+202E`, `U+2066`–`U+2069`), zero-width joiners, homoglyphs,
and unexpected codepoints from other scripts. Bidi overrides in particular can
make displayed text differ from its logical order — the same trick behind the
"Trojan Source" attacks — which in a typing trainer means the user sees one thing
and is graded against another.

**Mitigations**

- Sanitise at corpus build time, not render time. Allowlist: Khmer block
  (`U+1780`–`U+17FF`), Khmer symbols (`U+19E0`–`U+19FF`), basic Latin, digits,
  and a fixed punctuation set. Reject anything else and log it for review.
- Explicitly strip all bidi control characters and `U+200B`.
- Write this as a script (`scripts/validate-corpus.ts`) that runs in CI, so a
  future corpus addition can't bypass it.
- Also a licensing matter: Khmer Wikipedia is CC BY-SA. Ship attribution and
  keep `public/corpus/LICENSE` accurate.

---

## 6. Service worker persistence — MEDIUM

A service worker is the stickiest thing you can ship. A broken or malicious one
survives reloads and can serve stale assets indefinitely to users who never
return to a good version.

**Mitigations**

- Configure `vite-plugin-pwa` with `skipWaiting` and `clientsClaim` so updates
  take effect promptly.
- Build and test a kill-switch before launch: a version of the SW that
  unregisters itself and clears caches. Know that it works *before* you need it.
- Never cache the corpus or WASM with an opaque, unversioned cache key. Version
  every precached asset so a bad build can be superseded.
- Verify update behaviour on a real device, not just a dev tools hard-reload.

---

## 7. SQLite import — MEDIUM (avoidable entirely)

The export feature is safe. The **import** feature is the most dangerous thing
you could add. Parsing an attacker-supplied SQLite file exposes you to the
SQLite parser itself, and a crafted database can carry views and triggers that
execute logic on open.

**Mitigations**

- Make the format asymmetric: **export as `.sqlite`, import as JSON.** You keep
  the "own your data" benefit and remove the parser attack surface completely.
- If you must accept `.sqlite`: open it read-only in a throwaway connection,
  validate the schema against an expected shape, copy rows into a fresh database,
  then discard the imported file. Never attach it to the live DB.
- Cap import file size and row counts.

---

## 8. Client-side SQL injection — LOW

Limited blast radius — it's the user's own local database — but string-concatenated
SQL over corpus text or a user-entered profile name can corrupt or drop their
data, and it compounds §7.

**Mitigations**

- Bound parameters everywhere. No template literals in SQL, ever.
- Wrap the worker API so callers physically cannot pass a raw query string.
- Add an ESLint rule or a grep in CI for `db.exec(\`` with interpolation.

---

## 9. Missing response headers — LOW

Not a vulnerability by itself, but the layer that limits the damage from §1 and §2.

**Mitigations** — Netlify `_headers` or `netlify.toml`:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

Notes:

- `'wasm-unsafe-eval'` is required or SQLite-WASM won't instantiate. You will hit
  this; it's expected, not a workaround.
- `connect-src 'self'` is the important line — with no outbound origins allowed,
  a compromised dependency has nowhere to send keystrokes. This single directive
  does more for §1 than anything else on the list.
- `worker-src blob:` may be needed depending on how Vite emits the worker. Verify
  against `npm run preview`, not `npm run dev`.
- Tighten `style-src` if you can drop `unsafe-inline`; Tailwind's build output
  usually allows it.
- If you switch to the plain `opfs` VFS you'll add COOP/COEP. Those are hardening,
  not risk — but re-test that fonts and WASM still load.

---

## 10. Focus and input capture — LOW (resolved by design)

**Resolved as of the F-03 fix, verified against the code — not resolved by this
document alone.** This section previously asserted the fix below as already true
while the shipped input was still `sr-only` and `autoFocus`: exactly the hidden,
autofocused capture this section says must not exist. `docs/SECURITY-AUDIT-FINDINGS.md`
F-03 caught the gap and it is corrected in the current source. The lesson, stated
plainly so it doesn't repeat: a review section that certifies a control reads as
settled only once the grep or test behind it has actually been run against the
code, not when the intended design is written down. Treat "Resolved" in this file
as a claim to re-verify, not a fact to inherit.

The original design used a hidden input, which was capture the user could not
perceive: it could hold focus outside an active test and silently record
keystrokes intended for something else, and it broke keyboard accessibility.

The current design is the TypeRacer model — a **visible input the user must click
to focus**, with the keydown handler bound to that element and nothing else. This
is a real property, not a cosmetic one:

- Keyboard events target the focused element, so the handler *cannot* fire when
  the input is unfocused. Scoping is enforced by the platform rather than by
  attach/detach logic that could regress.
- Recording state is visible. The user can see when the app is listening and
  remove focus at any time.
- Accessibility follows for free: Tab reaches the control, screen readers
  announce it, and the focus ring communicates state.
- Accidental capture from autofill, password managers, or another focused field
  is eliminated.

**Remaining checks**

- No keyboard listener on `document` or `window` anywhere in the codebase. This
  is now a mechanical grep, not a judgment call — see the audit prompt §2.4.
- No `autoFocus` on mount.
- `onBlur` pauses the test rather than continuing to time silently.
- `data-1p-ignore` and `data-lpignore="true"` set, so password managers don't
  inject an overlay into the typing field.

**What this does not fix.** A compromised dependency does not consult your focus
model — it binds its own listener to `document` and reads everything. This change
makes the application well-behaved; it does not raise the bar for §1 or §2. The
controls that matter there are unchanged.

---

## 11. Storage exhaustion — LOW

Unbounded `keystrokes` growth eventually hits the OPFS quota and the app breaks.
An availability bug rather than an attack, but it's a guaranteed one.

**Mitigations**

- Implement the retention policy from §3.
- Check `navigator.storage.estimate()` on startup and warn before the quota bites.
- Handle quota errors so the app degrades to "results not saved" rather than
  failing to load.

---

## 12. Agent-assisted development — LOW, but worth habits

Claude Code has file-write and shell access to this repo.

- Review diffs. Don't blanket-approve write and bash permissions.
- Corpus text pulled from the internet is untrusted input that an agent will read.
  Instructions embedded in scraped text can influence agent behaviour — keep
  scraped material in a clearly-marked data directory and don't ask the agent to
  act on its contents.
- There are no secrets in this project. Keep it that way; it removes the most
  common agent-related leak entirely.

---

## Pre-launch checklist

- [ ] `package-lock.json` committed; `npm ci` used everywhere
- [ ] `ignore-scripts=true` in `.npmrc`
- [ ] `npm audit --omit=dev` clean
- [ ] 2FA on GitHub and Netlify; `main` protected
- [ ] CSP live and verified against `npm run preview` — check `connect-src`
- [ ] `react/no-danger` ESLint rule enforced
- [ ] Corpus validator runs in CI; bidi and ZWSP stripped
- [ ] Import path is JSON, not `.sqlite`
- [ ] All SQL uses bound parameters
- [ ] Retention policy implemented; "Clear all my data" works
- [ ] Service worker kill-switch tested on a real device
- [ ] Keydown handler bound to the input element only — none on `document`/`window`
- [ ] Input is visible, click-to-focus, never autofocused; blur pauses the test
- [ ] Zero third-party network requests in production — verify in the Network tab
- [ ] README states data stays local and OPFS is unencrypted

---

## Explicitly not worth your time

Don't cargo-cult these into a backend-less app:

- Rate limiting, WAF, DDoS protection — Netlify's edge handles what exists
- CSRF tokens — no state-changing server requests
- Password policy, MFA, session management — no accounts
- Client-side encryption of the local DB — the key would have to live beside it
- Obfuscating the bundle — it protects nothing here
- A cookie consent banner — you set no cookies and run no analytics. Keep it that
  way and the question never arises.