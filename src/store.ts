import { create } from 'zustand';
import type { InputMode } from './keyboard/nida';
import { loadSettings, saveSettings, type Theme } from './storage';

interface AppState {
  inputMode: InputMode;
  theme: Theme;
  showKeyboard: boolean;
  /** Bumped after every saved run; panels subscribe to know when to re-query. */
  sessionsSaved: number;
  /** Bumped when a new key is learned in OS mode; <KeyboardHint> subscribes to know when to re-render. */
  layoutLearned: number;
  setInputMode: (mode: InputMode) => void;
  setTheme: (theme: Theme) => void;
  setShowKeyboard: (show: boolean) => void;
  noteSessionSaved: () => void;
  noteLayoutLearned: () => void;
}

/**
 * Zustand rather than Context: components subscribe with a selector, so a store
 * change only re-renders the components that read the field that changed. The
 * performance invariant (one keypress re-renders one `<Word>`) depends on that,
 * and Context cannot provide it.
 */
export const useStore = create<AppState>((set, get) => {
  const persist = () =>
    saveSettings({ inputMode: get().inputMode, theme: get().theme, showKeyboard: get().showKeyboard });

  return {
    ...loadSettings(),
    sessionsSaved: 0,
    layoutLearned: 0,
    setInputMode: (inputMode) => {
      set({ inputMode });
      persist();
    },
    setTheme: (theme) => {
      set({ theme });
      persist();
    },
    setShowKeyboard: (showKeyboard) => {
      set({ showKeyboard });
      persist();
    },
    // Not persisted: it counts saves in this tab, not sessions on disk.
    noteSessionSaved: () => set((s) => ({ sessionsSaved: s.sessionsSaved + 1 })),
    // Not persisted: the learned layout itself lives in storage/index.ts
    // (see observed.ts); this counter only exists to trigger a re-render.
    noteLayoutLearned: () => set((s) => ({ layoutLearned: s.layoutLearned + 1 })),
  };
});
