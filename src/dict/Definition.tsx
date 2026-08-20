import { useEffect, useState } from 'react';
import { lookup, type Entry } from './index';

type State =
  | { kind: 'loading' }
  /**
   * Found, or looked up and genuinely absent — both are answers. More than one
   * entry when the tapped word is several dictionary words the segmenter kept
   * together, such as ខែសីហា "August" (ខែ "month" + សីហា).
   */
  | { kind: 'done'; entries: Entry[] }
  | { kind: 'error'; message: string };

/**
 * R4: what a tapped word means.
 *
 * Renders nothing at all until a word is tapped, and the dictionary itself is
 * not fetched until then either — see `loadDict`.
 */
export function Definition({ word, onClose }: { word: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    lookup(word).then(
      (entries) => !cancelled && setState({ kind: 'done', entries }),
      (e: unknown) =>
        !cancelled &&
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );

    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <aside className="card space-y-3 p-4" aria-label="Dictionary">
      <div className="flex items-start justify-between gap-4">
        <p className="font-khmer text-2xl leading-[1.6]" lang="km">
          {word}
        </p>
        <button
          onClick={onClose}
          aria-label="Close the dictionary"
          className="text-muted hover:text-fg focus-visible:ring-caret shrink-0 cursor-pointer rounded-md px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          Close
        </button>
      </div>

      {/*
        One live region for every outcome, so a screen reader hears the answer
        arrive rather than only seeing it appear.
      */}
      <div role="status" className="space-y-3">
        {state.kind === 'loading' && <p className="text-muted text-sm">Looking it up…</p>}

        {state.kind === 'error' && (
          <p className="text-error text-sm">Could not load the dictionary: {state.message}</p>
        )}

        {state.kind === 'done' && state.entries.length === 0 && (
          <p className="text-muted text-sm">
            No entry. Proper nouns and words coined after 1967 are often missing from both
            dictionaries.
          </p>
        )}

        {/*
          Usually one entry. When the word turned out to be several, each gets
          its own headword above its gloss — otherwise two definitions would sit
          under one heading with nothing saying which half of the word each
          belongs to.
        */}
        {state.kind === 'done' &&
          state.entries.map((entry) => (
            <Sense key={entry.word} entry={entry} showWord={state.entries.length > 1} />
          ))}
      </div>

      {/*
        Attribution stays on screen, not buried in a NOTICE file: all three sources
        are licensed on the condition that they are credited, and this is the
        one place a reader of the definition can see whose work it is.
      */}
      <p className="border-border text-muted border-t pt-2 text-[0.7rem]">
        វចនានុក្រមខ្មែរ (Chuon Nath), Buddhist Institute 1967, digitised by the Open Institute —
        LGPL-2.1. English glosses and modern Khmer definitions: Wiktionary — CC BY-SA.
      </p>
    </aside>
  );
}

/**
 * One dictionary entry.
 *
 * English first and at full weight, Khmer under it. Both are shown — this is a
 * Khmer trainer and the Khmer definition is the fuller of the two — but the
 * English gloss is the one that has to answer "what does this mean" at a
 * glance, so it does not get to be a footnote.
 */
function Sense({ entry, showWord }: { entry: Entry; showWord: boolean }) {
  return (
    <div className="space-y-3">
      {showWord && (
        <p className="font-khmer text-muted text-lg leading-[1.6]" lang="km">
          {entry.word}
        </p>
      )}

      {entry.en ? (
        <p className="text-lg leading-relaxed font-medium" lang="en">
          {entry.en}
        </p>
      ) : (
        // Said out loud rather than left blank: a reader who leans on the
        // English needs to know the gap is in the dictionary, not in the
        // word. Rare headwords are the ones Wiktionary tends to miss.
        <p className="text-muted text-sm" lang="en">
          No English gloss for this word — the Khmer definition is below.
        </p>
      )}

      {/*
        Both Khmer definitions when both exist, newest first and always
        labelled. Chuon Nath is authoritative but written in 1967, and its
        entries can read as circular to a modern speaker; Khmer Wiktionary is
        plainer but covers far fewer words. Neither replaces the other, so
        neither is shown unlabelled.

        Full contrast, not muted: English leads by size and weight, and dimming
        the Khmer would demote it rather than promote the gloss. She reads both.
      */}
      {entry.modern && <Definitions label="ខ្មែរ · Wiktionary" text={entry.modern} />}
      {entry.kh && <Definitions label="ខ្មែរ · Chuon Nath, 1967" text={entry.kh} />}
    </div>
  );
}

/** One labelled Khmer definition. Which dictionary it came from is part of it. */
function Definitions({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-border border-t pt-3">
      <p className="text-muted mb-1 text-[0.7rem] font-semibold tracking-wide uppercase">
        {label}
      </p>
      <p className="font-khmer leading-[1.9]" lang="km">
        {text}
      </p>
    </div>
  );
}
