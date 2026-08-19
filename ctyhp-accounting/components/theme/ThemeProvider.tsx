"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  parseThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/domain/theme";

interface ThemeContextValue {
  /** What the reader chose: light, dark, or follow the machine. */
  mode: ThemeMode;
  /** What that means right now — the only thing anything renders against. */
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Holds the theme, writes it onto `<html>`, and keeps following the machine
 * for as long as the reader has not overruled it.
 *
 * Server-rendered as "light" and corrected on mount, which is the only shape
 * available: the server cannot know what this browser stores or what its
 * operating system prefers, and rendering a guess would be a hydration
 * mismatch. The gap is invisible because the inline script in layout.tsx has
 * already set the attribute before React runs — this provider is catching up
 * with what the document already says, not deciding it for the first time.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (err) {
      // Private browsing refuses storage. Following the machine is a working
      // app; a throw here is a blank one.
      console.warn("reading the stored theme failed:", err);
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(parseThemeMode(stored));
    setSystemPrefersDark(query.matches);

    // Kept live rather than read once: somebody whose machine switches at
    // sunset has chosen "system" precisely so the app follows it then.
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = resolveTheme(mode, systemPrefersDark);

  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  }, [theme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
      console.warn("saving the theme failed:", err);
    }
  }, []);

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Throws outside the provider rather than defaulting to light. A control that
 * silently does nothing is harder to notice than one that fails on the first
 * render after being put in the wrong place.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
