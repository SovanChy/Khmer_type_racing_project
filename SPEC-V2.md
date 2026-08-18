# Build Spec V2: Khmer NiDA Typing Trainer

V1 is complete (`SPEC.md`, Phases 1–6). This file is where V2 requirements go.

**How to use this file:** write your requirements under
[Requirements](#requirements). Everything above that section is context so a
requirement doesn't have to restate what already exists. Everything below it is
a template and a menu of known open items — delete what you don't want.

`SPEC.md` is now frozen as the V1 record. Don't edit it; supersede it here.

---

## V1 baseline — what already exists

Don't re-request any of this. Reference it instead.

| Area | What shipped |
|---|---|
| Cluster engine | `src/khmer/` — custom `segment()` (never `Intl.Segmenter`), `stripInvisible()`, codepoint-level `compare()` with a codepoint→cluster index map |
| Input | `src/keyboard/` — two modes: in-app remap via `event.code` (default) and OS layout via `event.key`. Hidden `<input>`, `preventDefault()`. Table in `nida.json`, 3 layers, validated by test |
| Typing UI | `src/typing/` — timed 15/30/60s, word-count 25/50/100, drill toggle, live CPM + accuracy, results screen, light/dark. One keypress re-renders one `<Word>` |
| Storage | `src/storage/` — SQLite WASM (`opfs-sahpool`) in a Web Worker behind one module. Settings in `localStorage`. Export/import `.sqlite`. Second tab detected via BroadcastChannel |
| Analytics | `src/Analytics.tsx` — worst clusters, worst coeng subscripts (recency-weighted), slowest codepoints by mean time-to-keystroke, CPM/accuracy trend over recent sessions |
| Drill mode | `src/corpus/index.ts` — passage generation weighted toward weak clusters, drawn from real corpus text only |
| Ship | PWA (offline: shell, font, WASM, corpus), `netlify.toml`, `README.md` |

---

## Standing constraints (inherited)

These carry over from `SPEC.md` and `CLAUDE.md` unless a requirement below
explicitly overrides one. If you want to lift a constraint, say so by name.

- No backend, no API keys, no telemetry, no paid services. Static `dist/`.
- Tailwind only. No component library, no CSS-in-JS.
- TypeScript strict. New dependencies need a one-line justification.
- Never `Intl.Segmenter` for Khmer clusters.
- Never generate or "fix" NiDA mappings from memory.
- Compare at the codepoint level, render at the cluster level.
- One keypress re-renders exactly one `<Word>`.
- All storage goes through `src/storage/index.ts`.

---

## Open items carried out of V1

Real gaps, not speculation. Pull from this list or ignore it.

### Blocking on you, not on code

1. **The NiDA table is placeholder data.** `src/keyboard/nida.json` has
   `verified: false` and 5 deliberately-synthetic keys. Remap mode produces
   nonsense until you supply the verified table. The app warns about this in the
   UI. **This is the single biggest thing standing between V1 and something
   usable.**
2. **The corpus is 20 placeholder sentences.** `public/corpus/placeholder.json`.
   Drill mode can only be as good as the text it draws from.

### Known technical ceilings

3. **Multi-tab is detected, not supported.** `opfs-sahpool` isn't multi-tab safe,
   so the second tab gets a notice and no persistence. Real support needs a
   different VFS or a shared-worker arbiter.
4. **Mobile remap mode doesn't work.** Software keyboards don't emit meaningful
   `event.code`. The hidden input keeps mobile *usable* in OS mode only.
5. **PWA icon is SVG-only.** No PNG 192/512, no apple-touch-icon, so iOS install
   is degraded. See the `ponytail:` marker in `index.html`.
6. **Accuracy rescans the typed buffer each keystroke**
   (`src/typing/TypingTest.tsx:242`) — O(n) per key, fine at 150 words.
7. **Hesitation analytics discard long gaps** as "looked away"
   (`src/storage/analytics.ts:14`). The threshold is a guess, not measured.
8. **No on-screen keyboard.** Nothing shows the learner which physical key
   produces which Khmer codepoint — arguably the biggest teaching gap for a
   layout most users have never seen.

---

## Requirements

> Write V2 requirements here. One numbered block each. Delete the example.

Use this shape — it's what made `SPEC.md` executable:

```markdown
### R1 — <short name>

**What:** one paragraph, in terms of user-visible behaviour.

**Why:** the problem it solves. If this is empty, cut the requirement.

**Done when:** a list someone else could check without asking you.

**Explicitly out of scope:** the adjacent thing you do NOT want built.

**Stop and ask me if:** the condition where guessing would be worse than
waiting — e.g. anything touching the NiDA table, or a new dependency.
```

<!-- Example, delete when you add your own:

### R1 — On-screen keyboard hint

**What:** A keyboard diagram under the typing area highlighting the physical key
for the next expected codepoint. Toggleable, off by default, persisted.

**Why:** Learners can't build muscle memory for a layout they can't see, and
NiDA is unfamiliar to most users. Open item #8.

**Done when:**
- Renders all three layers (base / shift / AltGr), reading `nida.json` only.
- Highlights the key for the next target codepoint, updating per keystroke.
- Hidden entirely when the table is unverified, or when in OS layout mode.
- Does not break the one-`<Word>`-per-keypress invariant — verify with the
  dev render counter.

**Explicitly out of scope:** finger-position colouring, animation, mobile.

**Stop and ask me if:** rendering it requires any mapping not already in
`nida.json`.

-->

### R1 —

Touch Typing tutorial UI interface where it shows what on the keyboard should be typed and what is the next word we should type

The reason is that it will help the user learn what keyboard to type for the current word that they are reading like how a person learn to type with 5 fingers


### R2 —

show what key stroke that I type wrong at a specific letter and what is right with green (correct) and red (incorrect)

The reason for this is to indicate that I typed the wrong. There is an existing indication, but it only show a light white and yellow which doesn't really help. Also, I want it to show at a specific character. Like there are smaller characters in khmer like ្គ and highlight that when I wrote it wrong. Don't forget to add this coloring to the keyboard in R1 UI too

Also, when typed wrong, show what should be the correct placement on the keyboard indicator like a hint for it

### R3 — 

Allow me to enter quote that I copy and paste from somewhere else. I want to test out some newspaper quote, so I can copy it and test typing it out on the website. This includes proper spacing កើត ទេ which the keyboard  should recognize in R2

reason: help the user type what type of quote they want to type

### R4 -

dictionary feature where a user can tap on the word and look up what it means. This is great for no time limit where you can go with the flow and practice touch typing at the same time


### R5
- indicator when timr is out

---

## Working agreement for V2

- Opus orchestrates and reasons; Sonnet implements. (`CLAUDE.md`)
- One requirement at a time. At the end of each: run tests, run
  `npm run build`, summarise what changed and how to verify it. Don't start the
  next without being asked.
- If a requirement turns out to be wrong once you're in the code, say so and
  stop — don't silently work around it.
