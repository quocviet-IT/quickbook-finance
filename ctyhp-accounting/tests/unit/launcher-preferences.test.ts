import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLauncherCollapsed,
  setLauncherCollapsed,
} from "@/lib/client/launcher-preferences";

const KEY = "ctyhp.assistant-launcher.collapsed";

/** A localStorage stand-in; the unit suite runs in node, with no window. */
function stubWindow(store: Map<string, string>, options: { throws?: boolean; phone?: boolean } = {}) {
  vi.stubGlobal("window", {
    ...(options.phone === undefined
      ? {}
      : { matchMedia: (query: string) => ({ matches: options.phone === true && query.includes("max-width") }) }),
    localStorage: {
      getItem: (key: string) => {
        if (options.throws) throw new Error("localStorage is disabled");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (options.throws) throw new Error("localStorage is disabled");
        store.set(key, value);
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("launcher collapse preference", () => {
  it("starts expanded, so the controls can be found at all", () => {
    stubWindow(new Map());
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("remembers a collapse, which is the whole point of the button", () => {
    const store = new Map<string, string>();
    stubWindow(store);
    setLauncherCollapsed(true);
    expect(store.get(KEY)).toBe("true");
    expect(isLauncherCollapsed()).toBe(true);

    setLauncherCollapsed(false);
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("reads as expanded on the server, where there is no stored choice", () => {
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("still works where localStorage throws, it just forgets", () => {
    stubWindow(new Map(), { throws: true });
    expect(() => setLauncherCollapsed(true)).not.toThrow();
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("starts collapsed on a phone, where the row of buttons covers most of the bottom of the screen", () => {
    stubWindow(new Map(), { phone: true });
    expect(isLauncherCollapsed()).toBe(true);
    stubWindow(new Map(), { phone: false });
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("follows a choice once made, on a phone too", () => {
    const store = new Map([[KEY, "false"]]);
    stubWindow(store, { phone: true });
    expect(isLauncherCollapsed()).toBe(false);
  });

  it("treats any other stored value as expanded", () => {
    const store = new Map([[KEY, "yes"]]);
    stubWindow(store);
    expect(isLauncherCollapsed()).toBe(false);
  });
});
