# Khmer NiDA Typing Trainer

A MonkeyType-style typing trainer for the Khmer NiDA keyboard layout.
Static site, no backend, free hosting on Netlify.

**The build plan lives in `SPEC.md`.** Read it before starting a phase.
This file is standing rules that apply to every session.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # production build → dist/
npm run preview    # serve dist/ locally — ALWAYS check this, not just dev
npm test           # Vitest
npm run typecheck  # tsc --noEmit
```

## Hard rules

- **Never use `Intl.Segmenter` for Khmer grapheme clusters.** It splits coeng
  sequences. Use the segmenter in `src/khmer/segment.ts`.
- **Never generate or "fix" NiDA key mappings from memory.** If a mapping looks
  wrong, say so and stop. A wrong layout teaches wrong muscle memory.
- **Compare at the codepoint level, render at the cluster level.** These are not
  interchangeable. See `SPEC.md` Phase 1.
- No backend, no API keys, no telemetry, no paid services.
- No new dependencies without a one-line justification first.
- Tailwind only — no CSS-in-JS, no component library.

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- All storage goes through `src/storage/index.ts`. Nothing imports the SQLite
  worker directly.
- Khmer test fixtures live in `src/khmer/__fixtures__/`. Add to them rather than
  inlining Khmer literals in test files.
- Comments explain *why*, not *what*.

## Performance invariant

One keypress must re-render exactly one `<Word>` component. If a change makes
the passage re-render, that's a bug, not a tradeoff. The dev-mode render counter
exists to catch this — check it after touching anything in `src/typing/`.

## Known gotchas

- The SQLite WASM build must run in a Web Worker. Vite needs
  `optimizeDeps.exclude` for it. If dev works and `npm run preview` doesn't,
  this is why.
- `opfs-sahpool` VFS is not multi-tab safe. Second tab must be detected, not
  ignored.
- Corpus text may contain `U+200B` (zero-width space). Always run it through
  `stripInvisible()` at load.
- Test Khmer rendering in an actual browser. Terminal output is not reliable for
  stacked glyphs.

## Workflow

Work one phase at a time. At the end of each phase: run tests, run
`npm run build`, then summarise what changed and how to verify it. Don't start
the next phase without being asked.

Opus will be the orchestrator and reasoning model while Sonnet will be used to build the implementation from Opus



## Skills
use Superpower and UX UI pro skills to build the project