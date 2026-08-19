import { describe, expect, it } from "vitest";
import {
  THEME_ATTRIBUTE,
  THEME_MODES,
  THEME_STORAGE_KEY,
  noFlashScript,
  parseThemeMode,
  resolveTheme,
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
