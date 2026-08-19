/**
 * Which theme the app is in, and how that is decided.
 *
 * Three modes, not two. "Dark" and "light" are the reader's own choice;
 * "system" defers to the machine and is the default, because most people have
 * already told their operating system which they prefer and should not have to
 * say it again here.
 *
 * The choice is expressed as one attribute on `<html>` and nothing else. The
 * stylesheet selects dark on `:root[data-theme="dark"]` rather than on a
 * `prefers-color-scheme` media query, and that is the reason why: a media
 * query cannot be overridden by a click. Following the system is done by
 * *writing* `dark` into the attribute, so there is exactly one thing that
 * decides which block applies and exactly one place to look when it is wrong.
 *
 * Pure: no React, no DOM, no storage API. What the browser does with these
 * answers lives in components/theme/ThemeProvider.tsx.
 */

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The two themes anything can actually be rendered in. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "onebook.theme";
export const THEME_ATTRIBUTE = "data-theme";

/** What `mode` means right now, given what the machine says it prefers. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

/**
 * A stored preference, narrowed to something usable.
 *
 * Anything unrecognised means "system" rather than an error: storage is
 * editable by hand and outlives the release that wrote it, and an unreadable
 * preference must not leave the app with no theme at all.
 */
export function parseThemeMode(stored: string | null | undefined): ThemeMode {
  return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : "system";
}

/**
 * The script that sets the theme before anything is painted.
 *
 * It has to run inline, in the document head, ahead of React — otherwise the
 * first paint is the light theme and the reader watches it turn dark a moment
 * later, on every single navigation that reloads. That flash is the one thing
 * a theme switch is judged on.
 *
 * It is wrapped in try/catch because it runs unguarded: Safari in private
 * mode throws on `localStorage` outright, and a throw here is a blank
 * document rather than a wrong colour.
 *
 * Returned as a string from this module so the key and the attribute have one
 * definition each. Written as a second copy inside layout.tsx they could
 * drift, and the symptom would be a theme that applies on first paint and
 * then changes on hydration — the flash, arriving slightly later.
 */
export function noFlashScript(): string {
  return (
    "try{" +
    `var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    "var d=m==='dark'||((m==null||m==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);" +
    `document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},d?'dark':'light');` +
    "}catch(e){}"
  );
}

/**
 * The preference as a cookie, which is what lets the SERVER know the theme.
 *
 * localStorage never leaves the browser. With only it, the server always
 * rendered the light theme and corrected after hydration — so a dark reader
 * watched every reload, and every company switch, arrive light and then turn
 * dark, for seconds on a heavy page. The cookie rides the request, the layout
 * reads it, and the first server-rendered byte is already the right theme.
 *
 * Same name as the storage key on purpose: two names would be two copies of
 * the preference with no rule for which one wins.
 */
export function themeCookie(mode: ThemeMode): string {
  return `${THEME_STORAGE_KEY}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
}
