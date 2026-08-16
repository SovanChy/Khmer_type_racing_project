import { Fragment, memo } from 'react';
import { clusterView, type CellStatus, type WordProps } from './engine';

/**
 * Dev-only instrument for the passage-render invariant.
 *
 * Counted in the render phase, so React StrictMode's double-invoke doubles it:
 * a keypress reads 2, not 1. That is fine — the question this answers is "did
 * one word re-render, or all of them?", and 2-vs-200 answers it unambiguously.
 * It is deliberately not React state; an instrument that re-rendered the tree
 * would perturb the thing it is measuring.
 */
export const wordRenders = { count: 0 };

const CELL_CLASS: Record<CellStatus, string> = {
  correct: 'text-fg',
  incorrect: 'text-error underline decoration-error/50 underline-offset-4',
  partial: 'text-fg/60',
  pending: 'text-muted',
};

/**
 * Zero-width marker, so inserting it between clusters cannot shift the text it
 * sits in. Never wraps a cluster — a positioned box around a stacked glyph is
 * what breaks Khmer rendering.
 */
function Caret() {
  return (
    <span aria-hidden className="relative inline-block w-0 align-baseline">
      <span className="bg-caret motion-safe:animate-pulse absolute -top-[0.15em] -left-px h-[1.15em] w-0.5 rounded-full" />
    </span>
  );
}

/**
 * One word of the passage.
 *
 * Memoised on purpose: finished and not-yet-reached words receive identical
 * props on every keystroke and bail out, leaving only the active word to
 * re-render. Adding a prop that changes each keystroke — a timer, a callback
 * built inline, an object literal — silently defeats this and re-renders the
 * whole passage.
 */
export const Word = memo(function Word({ target, typed, status }: WordProps) {
  if (import.meta.env.DEV) wordRenders.count++;

  const { cells, caret } = clusterView(target, typed);

  return (
    <span className="whitespace-pre">
      {cells.map((cell, i) => (
        <Fragment key={i}>
          {status === 'active' && i === caret && <Caret />}
          <span className={CELL_CLASS[cell.status]}>{cell.text}</span>
        </Fragment>
      ))}
      {status === 'active' && caret === cells.length && <Caret />}
    </span>
  );
});
