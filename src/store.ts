import { create } from 'zustand';
import type { InputMode } from './keyboard/nida';
import { loadSettings, saveSettings } from './storage';

interface AppState {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
}

/**
 * Zustand rather than Context: components subscribe with a selector, so a store
 * change only re-renders the components that read the field that changed. The
 * Phase 3 performance invariant (one keypress re-renders one `<Word>`) depends
 * on that, and Context cannot provide it.
 */
export const useStore = create<AppState>((set) => ({
  inputMode: loadSettings().inputMode,
  setInputMode: (inputMode) => {
    saveSettings({ inputMode });
    set({ inputMode });
  },
}));
