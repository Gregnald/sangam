import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "sangam.theme";

function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  /** True when the user picked explicitly; otherwise we follow the OS. */
  explicit: boolean;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  /** Read the stored choice (or the OS preference) and apply it. Call once at startup. */
  init: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "dark",
  explicit: false,

  setTheme: (theme) => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable — the choice just won't persist
    }
    set({ theme, explicit: true });
  },

  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

  init: () => {
    const stored = readStored();
    const theme = stored ?? systemTheme();
    apply(theme);
    set({ theme, explicit: stored !== null });
    // Follow the OS while the user hasn't chosen.
    try {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", (e) => {
        if (!get().explicit) {
          const t: Theme = e.matches ? "light" : "dark";
          apply(t);
          set({ theme: t });
        }
      });
    } catch {
      // matchMedia unavailable
    }
  },
}));
