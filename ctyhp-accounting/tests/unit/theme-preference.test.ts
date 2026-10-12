import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYSTEM_THEME_COOKIE,
  THEME_ATTRIBUTE,
  THEME_MODES,
  THEME_STORAGE_KEY,
  noFlashScript,
  parseSystemPrefersDark,
  parseThemeMode,
  resolveTheme,
  systemThemeCookie,
  themeCookie,
} from "@/lib/domain/theme";

describe("theme modes", () => {
  it("offers exactly light, dark and system", () => {
    expect(THEME_MODES).toEqual(["light", "dark", "system"]);
  });
});

describe("resolveTheme", () => {
  it("follows the machine when the reader has not chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets the reader's choice beat the machine, in both directions", () => {
    // The reason the stylesheet selects on an attribute rather than on a
    // media query: a media query cannot be overridden by a click.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("parseThemeMode", () => {
  it("reads back what was stored", () => {
    for (const mode of THEME_MODES) expect(parseThemeMode(mode)).toBe(mode);
  });

  it("falls back to following the machine for anything else", () => {
    // localStorage is editable by hand and survives releases that renamed
    // things. An unreadable preference must not leave the app themeless.
    expect(parseThemeMode(null)).toBe("system");
    expect(parseThemeMode("")).toBe("system");
    expect(parseThemeMode("DARK")).toBe("system");
    expect(parseThemeMode("solarized")).toBe("system");
    expect(parseThemeMode("{}")).toBe("system");
  });
});

describe("noFlashScript", () => {
  const script = noFlashScript();

  it("names the same key and attribute the app uses", () => {
    // A second copy of either string would be a theme that applies on the
    // first paint and then changes on hydration — the flash it exists to
    // prevent, arriving a moment later.
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain(THEME_ATTRIBUTE);
  });

  it("reads the machine's preference too, not only storage", () => {
    expect(script).toContain("prefers-color-scheme");
  });

  it("cannot throw, whatever storage does", () => {
    // It runs before anything else on the page, unguarded by React. A throw
    // here is a blank document, not a wrong colour: Safari in private mode
    // refuses localStorage outright.
    expect(script).toContain("try");
    expect(script).toContain("catch");
  });

  it("is a single expression with no line breaks to be mangled", () => {
    // It is inlined into a <script> tag by dangerouslySetInnerHTML.
    expect(script).not.toContain("\n");
    expect(script).not.toContain("</script");
  });

  it("actually sets the attribute when storage says dark", () => {
    // Executed rather than pattern-matched: a script that reads correctly and
    // does nothing is the failure this test exists for.
    const attributes: Record<string, string> = {};
    const scope = {
      document: { documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) } },
      localStorage: { getItem: () => "dark" },
      matchMedia: () => ({ matches: false }),
    };
    new Function("document", "localStorage", "matchMedia", script)(
      scope.document,
      scope.localStorage,
      scope.matchMedia,
    );
    expect(attributes[THEME_ATTRIBUTE]).toBe("dark");
  });

  it("follows the machine when storage holds nothing", () => {
    const attributes: Record<string, string> = {};
    new Function("document", "localStorage", "matchMedia", script)(
      { documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) } },
      { getItem: () => null },
      () => ({ matches: true }),
    );
    expect(attributes[THEME_ATTRIBUTE]).toBe("dark");
  });

  it("leaves the attribute at light rather than unset when nothing wants dark", () => {
    // An unset attribute is the light theme, so this is not strictly
    // necessary — but a document that always says which theme it is in is one
    // the audit script can read, and one nobody has to infer.
    const attributes: Record<string, string> = {};
    new Function("document", "localStorage", "matchMedia", script)(
      { documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) } },
      { getItem: () => null },
      () => ({ matches: false }),
    );
    expect(attributes[THEME_ATTRIBUTE]).toBe("light");
  });
});

describe("themeCookie", () => {
  it("carries the mode under the same name the rest of the system uses", () => {
    // The cookie exists so the SERVER can know the theme: localStorage never
    // leaves the browser, so with only it the server always rendered light
    // and a dark reader watched every reload arrive light and then turn —
    // for seconds, on a heavy page. One name for cookie and storage, or the
    // two copies drift.
    expect(themeCookie("dark")).toContain(`${THEME_STORAGE_KEY}=dark`);
  });

  it("lives long enough to outlast a session, scoped to the whole app", () => {
    const cookie = themeCookie("dark");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("max-age=31536000");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("round-trips through the same parser storage uses", () => {
    for (const mode of THEME_MODES) {
      const value = themeCookie(mode).split(";")[0].split("=")[1];
      expect(parseThemeMode(value)).toBe(mode);
    }
  });
});

/**
 * "System" is the default mode, and the server cannot see the machine. It used
 * to render every system reader light and let the client turn dark after
 * hydration. Whatever hydrated after that turn — the report toolbar's
 * Accountant/Management switch, streamed in its own Suspense boundary — was
 * matched against the dark client render while its HTML said light, and React
 * does not patch attributes on hydration: the switch stayed light on a dark
 * page, every load, for every system reader on a dark machine.
 *
 * So the browser tells the server what the machine prefers, in a cookie the
 * no-flash script writes on every load, and the first server render is
 * already the theme the reader will see.
 */
describe("the machine's preference, for the server", () => {
  /** Runs the no-flash script against fakes and returns what it wrote. */
  function run(stored: string | null, prefersDark: boolean) {
    const attributes: Record<string, string> = {};
    const document = {
      cookie: "",
      documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) },
    };
    new Function("document", "localStorage", "matchMedia", noFlashScript())(
      document,
      { getItem: () => stored },
      () => ({ matches: prefersDark }),
    );
    return { attribute: attributes[THEME_ATTRIBUTE], cookie: document.cookie };
  }

  it("is written by the no-flash script on every load", () => {
    expect(run(null, true).cookie).toBe(systemThemeCookie(true));
    expect(run("system", false).cookie).toBe(systemThemeCookie(false));
  });

  it("records the machine even when the reader has chosen, so switching to System later renders right", () => {
    expect(run("light", true)).toEqual({ attribute: "light", cookie: systemThemeCookie(true) });
    expect(run("dark", false)).toEqual({ attribute: "dark", cookie: systemThemeCookie(false) });
  });

  it("still records the machine when storage refuses to be read", () => {
    // Safari in private mode throws on localStorage. The attribute cannot be
    // decided without it, but the machine's preference does not need it.
    const document = { cookie: "", documentElement: { setAttribute: () => undefined } };
    new Function("document", "localStorage", "matchMedia", noFlashScript())(
      document,
      {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
      () => ({ matches: true }),
    );
    expect(document.cookie).toBe(systemThemeCookie(true));
  });

  it("round-trips through the parser the layout uses", () => {
    for (const prefersDark of [true, false]) {
      const [name, value] = systemThemeCookie(prefersDark).split(";")[0].split("=");
      expect(name).toBe(SYSTEM_THEME_COOKIE);
      expect(parseSystemPrefersDark(value)).toBe(prefersDark);
    }
  });

  it("reads a missing or unrecognised cookie as light, what the server assumed before it had one", () => {
    expect(parseSystemPrefersDark(undefined)).toBe(false);
    expect(parseSystemPrefersDark("")).toBe(false);
    expect(parseSystemPrefersDark("DARK")).toBe(false);
  });

  it("is a separate cookie from the reader's choice, with the same lifetime and scope", () => {
    // One cookie for both would lose the choice the moment the machine changed.
    expect(SYSTEM_THEME_COOKIE).not.toBe(THEME_STORAGE_KEY);
    const cookie = systemThemeCookie(true);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("max-age=31536000");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });
});

describe("the server renders a system reader in the machine's theme", () => {
  const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("the root layout hands the machine's preference to the theme provider", () => {
    const layout = source("app/layout.tsx");
    expect(layout).toMatch(/parseSystemPrefersDark\(jar\.get\(SYSTEM_THEME_COOKIE\)\?\.value\)/);
    expect(layout).toMatch(/initialSystemPrefersDark=\{initialSystemPrefersDark\}/);
  });

  it("the provider's first render, server and client, starts from it", () => {
    // Starting from false again would put the light-then-dark turn back for
    // every system reader on a dark machine.
    expect(source("components/theme/ThemeProvider.tsx")).toMatch(
      /useState\(initialSystemPrefersDark\)/,
    );
  });

  it("the provider keeps the cookie current when the machine changes theme mid-session", () => {
    expect(source("components/theme/ThemeProvider.tsx")).toMatch(/systemThemeCookie\(event\.matches\)/);
  });
});
