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

/**
 * What the machine preferred when this browser last loaded a page: "dark" or
 * "light". Not a preference of the reader's — see systemThemeCookie.
 */
export const SYSTEM_THEME_COOKIE = "onebook.system-theme";

/** Every theme cookie lives a year and is sent on every path of the app. */
const COOKIE_ATTRIBUTES = "path=/; max-age=31536000; SameSite=Lax";

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
 *
 * It also records what the machine prefers, for the server: see
 * systemThemeCookie. That comes first, because it needs no storage — Safari's
 * private mode, which throws below, still gets it.
 */
export function noFlashScript(): string {
  return (
    "try{" +
    "var s=matchMedia('(prefers-color-scheme: dark)').matches;" +
    `document.cookie=${JSON.stringify(`${SYSTEM_THEME_COOKIE}=`)}+(s?'dark':'light')+${JSON.stringify(`; ${COOKIE_ATTRIBUTES}`)};` +
    `var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    "var d=m==='dark'||((m==null||m==='system')&&s);" +
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
  return `${THEME_STORAGE_KEY}=${mode}; ${COOKIE_ATTRIBUTES}`;
}

/**
 * What the machine prefers, as a cookie, so the server can render a "system"
 * reader in the theme they will actually see.
 *
 * The preference cookie above says "system" and nothing more, and the server
 * cannot see the machine. It used to render every system reader light and let
 * the client turn dark once React ran. Whatever hydrated after that turn was
 * matched against the dark render while its HTML said light, and React does
 * not patch attributes on hydration: the reports' Accountant/Management switch,
 * streamed in its own Suspense boundary, stayed light on a dark page on every
 * load. Every other Ant Design component sat light until the turn, too.
 *
 * A separate cookie, not a value of the first: that one is the reader's
 * choice and must survive the machine changing its mind. The no-flash script
 * writes this one on every load and the provider when the machine switches,
 * so it is wrong at most for the first page a browser ever loads.
 */
export function systemThemeCookie(prefersDark: boolean): string {
  return `${SYSTEM_THEME_COOKIE}=${prefersDark ? "dark" : "light"}; ${COOKIE_ATTRIBUTES}`;
}

/**
 * The cookie above, read back. Missing or unrecognised means light: what the
 * server assumed before there was a cookie, and a wrong guess it recovers from.
 */
export function parseSystemPrefersDark(value: string | null | undefined): boolean {
  return value === "dark";
}
