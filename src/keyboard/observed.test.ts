import { afterEach, describe, expect, it, vi } from 'vitest';
import { CP } from '../khmer/__fixtures__/khmer';

/**
 * observed.ts keeps `seed`/`learned` in module-level variables (see the
 * comments there for why: the seed must never persist and the merge must
 * stay O(1) per keystroke). Each test needs a clean instance of that state,
 * so this resets the module and re-imports it rather than adding a
 * production-only reset hook just for tests.
 */
async function freshObserved() {
  vi.resetModules();
  return import('./observed');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordKey', () => {
  it('returns true on first sight of a (code, layer, char) triple', async () => {
    const { recordKey } = await freshObserved();
    expect(recordKey('KeyQ', 'base', CP.KA)).toBe(true);
  });

  it('returns false on an exact repeat', async () => {
    const { recordKey } = await freshObserved();
    expect(recordKey('KeyQ', 'base', CP.KA)).toBe(true);
    expect(recordKey('KeyQ', 'base', CP.KA)).toBe(false);
  });

  it('rejects a non-Khmer character', async () => {
    const { recordKey } = await freshObserved();
    // 'q' is what an unremapped QWERTY key would report -- must never be
    // learned as if it were the Khmer letter that belongs there.
    expect(recordKey('KeyQ', 'base', 'q')).toBe(false);
  });
});

describe('observedLayout', () => {
  it('reflects a recorded key on the right layer', async () => {
    const { recordKey, observedLayout } = await freshObserved();
    recordKey('KeyQ', 'shift', CP.KHA);
    expect(observedLayout()).toEqual({ KeyQ: { shift: CP.KHA } });
  });

  it('lets learned data win over the seed for the same (code, layer)', async () => {
    const { recordKey, observedLayout, seedFromBrowser } = await freshObserved();

    // Stand in for navigator.keyboard.getLayoutMap(): reports KeyQ -> CP.KA,
    // as if that's what the OS layout produces on the base layer.
    const layoutMap = new Map([['KeyQ', CP.KA]]);
    vi.stubGlobal('navigator', {
      keyboard: { getLayoutMap: () => Promise.resolve(layoutMap) },
    });

    await seedFromBrowser();
    expect(observedLayout()).toEqual({ KeyQ: { base: CP.KA } });

    // The user's keyboard actually typed something different for KeyQ.base --
    // ground truth from typing must override the browser's seed.
    recordKey('KeyQ', 'base', CP.KHA);
    expect(observedLayout()).toEqual({ KeyQ: { base: CP.KHA } });
  });
});
