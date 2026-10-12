"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  parseThemeMode,
  resolveTheme,
  systemThemeCookie,
  themeCookie,
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
 * Server-rendered from two cookies, the reader's mode and what their machine
 * last preferred, so the first render — server and client alike — is the
 * theme the reader will see, and nothing has to change once React runs. A
 * change after hydration is not a safe correction: markup that hydrates later,
 * in a Suspense boundary, is matched against the changed render and React
 * leaves its attributes as the server wrote them (see systemThemeCookie).
 *
 * Storage is still read on mount, for the rare browser whose cookies lag it.
 * The inline script in layout.tsx has already set the attribute before React
 * runs, so this provider is catching up with what the document says, not
 * deciding it for the first time.
 */
export function ThemeProvider({
  children,
  initialMode = "system",
  initialSystemPrefersDark = false,
}: {
  children: React.ReactNode;
  /**
   * The mode the server read from the cookie, so the first render — server
   * and client alike — is already the right theme. Without it every reload
   * rendered light and corrected seconds later; see themeCookie.
   */
  initialMode?: ThemeMode;
  /**
   * What the machine preferred on this browser's last load, read by the
   * server from systemThemeCookie. It is what "system" means until the media
   * query below has been read.
   */
  initialSystemPrefersDark?: boolean;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [systemPrefersDark, setSystemPrefersDark] = useState(initialSystemPrefersDark);
  // False until the first effect has read storage. Two things wait on it:
  // the attribute write below, and the storage write-back.
  const [hydrated, setHydrated] = useState(false);

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
    const storedMode = stored === null ? null : parseThemeMode(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(storedMode ?? initialMode);
    setSystemPrefersDark(query.matches);
    setHydrated(true);
    // Self-heal the cookie for readers whose preference predates it: their
    // storage says dark, no cookie ever said so, and without this line every
    // one of their reloads keeps flashing forever.
    if (storedMode && storedMode !== initialMode) {
      try {
        document.cookie = themeCookie(storedMode);
      } catch (err) {
        console.warn("syncing the theme cookie failed:", err);
      }
    }

    // Kept live rather than read once: somebody whose machine switches at
    // sunset has chosen "system" precisely so the app follows it then. The
    // cookie follows too, or the next page would be server-rendered in the
    // theme the machine just left.
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
      try {
        document.cookie = systemThemeCookie(event.matches);
      } catch (err) {
        console.warn("syncing the system theme cookie failed:", err);
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
    // initialMode is set once by the server for the life of the document.
  }, [initialMode]);

  const theme = resolveTheme(mode, systemPrefersDark);

  useEffect(() => {
    // Not before storage has been read. The inline script in layout.tsx has
    // already set the attribute correctly before first paint; this effect
    // running with pre-hydration state used to overwrite that "dark" with
    // "light" for as long as hydration took — which on a heavy page was the
    // several-second flash a reader reported on every reload and company
    // switch. Once hydrated, this state is the authority and takes over.
    if (!hydrated) return;
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  }, [hydrated, theme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      // Both stores, always: the cookie is what the server reads on the next
      // request, the storage is what the no-flash script reads before paint.
      document.cookie = themeCookie(next);
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
