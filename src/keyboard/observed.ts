import { KHMER_CODEPOINT } from './nida';
import type { Layer, LayoutSource } from './layout';
import { loadObservedLayout, saveObservedLayout } from '../storage';

/**
 * The part of `navigator.keyboard.getLayoutMap()`'s result we actually read.
 * Chromium-only, and NOT in TypeScript's DOM lib -- checked lib.dom.d.ts,
 * there is no `KeyboardLayoutMap` type shipped with `typescript` -- so this
 * is a minimal local stand-in rather than an official type.
 */
interface KeyboardLayoutMap {
  entries(): IterableIterator<[string, string]>;
}
interface NavigatorWithKeyboard extends Navigator {
  keyboard?: { getLayoutMap: () => Promise<KeyboardLayoutMap> };
}

// From the browser at mount time. Deliberately NOT persisted: if the seed is
// wrong (see seedFromBrowser), it must not become sticky across reloads --
// only what the user actually typed correctly should survive.
let seed: LayoutSource = {};
// From keystrokes the user actually typed. Persisted via storage/index.ts.
let learned: LayoutSource = loadObservedLayout();

/**
 * The user's real OS-layout keyboard, as best observed: the browser-reported
 * base layer filled in first, keystroke observations winning per (code,
 * layer) since they are ground truth and the seed is only a guess.
 */
export function observedLayout(): LayoutSource {
  const merged: LayoutSource = {};
  for (const code of new Set([...Object.keys(seed), ...Object.keys(learned)])) {
    merged[code] = { ...seed[code], ...learned[code] };
  }
  return merged;
}

/**
 * Records one observed keystroke in OS mode. Returns true only when it adds
 * something the caller didn't already know, so `<KeyboardHint>` re-renders on
 * a newly learned key but not on every repeat of one already learned.
 */
export function recordKey(code: string, layer: Layer, char: string): boolean {
  if (!KHMER_CODEPOINT.test(char)) return false;
  if (learned[code]?.[layer] === char) return false;
  learned = { ...learned, [code]: { ...learned[code], [layer]: char } };
  saveObservedLayout(learned);
  return true;
}

/**
 * Seeds `seed` from the OS-reported layout once, at mount.
 *
 * ponytail: seeded once on mount, so switching the OS layout mid-session
 * isn't picked up until reload -- `recordKey` from actual typing covers the
 * gap anyway, since it observes whatever is active right now.
 */
export async function seedFromBrowser(): Promise<void> {
  try {
    const getLayoutMap = (navigator as NavigatorWithKeyboard).keyboard?.getLayoutMap;
    if (!getLayoutMap) return; // Firefox, Safari: no such API -- learning-only.
    const map = await getLayoutMap();
    const next: LayoutSource = {};
    for (const [code, char] of map.entries()) {
      // getLayoutMap() reports whichever layout is active AT CALL TIME. If
      // the user has English active when the page loads, this hands back
      // entries like KeyQ -> 'q'. Filtering to Khmer codepoints discards
      // that non-Khmer snapshot entirely instead of seeding the diagram with
      // the wrong language.
      // base only: getLayoutMap() reports no modifier layers.
      if (KHMER_CODEPOINT.test(char)) next[code] = { base: char };
    }
    seed = next;
  } catch {
    // Any failure here (API missing, permission denied, browser quirk) must
    // degrade to learning-only, quietly -- no console noise, no error UI.
  }
}
