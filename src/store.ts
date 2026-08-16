import { create } from 'zustand';
import type { InputMode } from './keyboard/nida';
import { loadSettings, saveSettings, type Theme } from './storage';

interface AppState {
  inputMode: InputMode;
  theme: Theme;
  setInputMode: (mode: InputMode) => void;
  setTheme: (theme: Theme) => void;
}

/**
 * Zustand rather than Context: components subscribe with a selector, so a store
 * change only re-renders the components that read the field that changed. The
 * performance invariant (one keypress re-renders one `<Word>`) depends on that,
 * and Context cannot provide it.
 */
export const useStore = create<AppState>((set, get) => {
  const persist = () => saveSettings({ inputMode: get().inputMode, theme: get().theme });

  return {
    ...loadSettings(),
    setInputMode: (inputMode) => {
      set({ inputMode });
      persist();
    },
    setTheme: (theme) => {
      set({ theme });
      persist();
    },
  };
});
