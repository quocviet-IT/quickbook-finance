import { afterEach, describe, expect, it, vi } from "vitest";
import {
  overviewLayoutKey,
  recallOverviewLayout,
  rememberOverviewLayout,
  subscribeOverviewLayout,
} from "@/lib/client/dashboard-layout-memory";
import { presetLayout, standardLayout } from "@/lib/domain/dashboard-home/layout";

/** localStorage as a plain map, and the window around it, with the `storage` listeners it was given. */
function fakeWindow(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const listeners = new Set<(event: { key: string | null }) => void>();
  const localStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
  };
  const window = {
    localStorage,
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === "storage") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === "storage") listeners.delete(listener);
    },
  };
  vi.stubGlobal("window", window);
  return { items, fire: (key: string | null) => listeners.forEach((listener) => listener({ key })), listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the remembered Overview layout", () => {
  it("is kept under one key per company, by its slug", () => {
    expect(overviewLayoutKey("demo_co")).toBe("onebook.dashboard.overview.demo_co");
    expect(overviewLayoutKey("sample_two")).not.toBe(overviewLayoutKey("demo_co"));
  });

  it("writes the saved layout's three lists as JSON and reads the same layout back", () => {
    const { items } = fakeWindow();
    const accountant = presetLayout("accountant");
    rememberOverviewLayout("demo_co", accountant);
    expect(JSON.parse(items.get("onebook.dashboard.overview.demo_co")!)).toEqual({
      order: accountant.order,
      shown: accountant.shown,
      wide: accountant.wide,
    });
    expect(recallOverviewLayout("demo_co")).toEqual(accountant);
    // Another company remembers nothing yet.
    expect(recallOverviewLayout("sample_two")).toBeNull();
  });

  it("reads a valid layout through normalizeOverview: an unknown card dropped, a missing one added at the end, hidden", () => {
    fakeWindow({
      "onebook.dashboard.overview.demo_co": JSON.stringify({ order: ["bank", "gone", "cash"], shown: ["bank", "gone"], wide: ["bank"] }),
    });
    const layout = recallOverviewLayout("demo_co")!;
    expect(layout.order.slice(0, 2)).toEqual(["bank", "cash"]);
    expect(layout.order).toHaveLength(standardLayout().order.length);
    expect(layout.shown).toEqual(["bank"]);
    expect(layout.wide).toEqual(["bank"]);
  });

  it("gives the same object for the same stored text, so useSyncExternalStore sees no change", () => {
    fakeWindow({ "onebook.dashboard.overview.demo_co": JSON.stringify(presetLayout("owner")) });
    const first = recallOverviewLayout("demo_co");
    expect(recallOverviewLayout("demo_co")).toBe(first);
    rememberOverviewLayout("demo_co", presetLayout("accountant"));
    expect(recallOverviewLayout("demo_co")).not.toBe(first);
    expect(recallOverviewLayout("demo_co")).toEqual(presetLayout("accountant"));
  });

  it("is null when nothing is remembered, when the text is not JSON, and when storage cannot be read", () => {
    fakeWindow();
    expect(recallOverviewLayout("demo_co")).toBeNull();
    fakeWindow({ "onebook.dashboard.overview.demo_co": "{not json" });
    expect(recallOverviewLayout("demo_co")).toBeNull();
    // A private-mode browser throws on every access.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(recallOverviewLayout("demo_co")).toBeNull();
    expect(() => rememberOverviewLayout("demo_co", standardLayout())).not.toThrow();
  });

  it("is null on the server, and remembering there does nothing", () => {
    expect(typeof window).toBe("undefined");
    expect(recallOverviewLayout("demo_co")).toBeNull();
    expect(() => rememberOverviewLayout("demo_co", standardLayout())).not.toThrow();
  });

  it("tells its subscribers of a layout kept in this tab and of one kept in another, and stops when unsubscribed", () => {
    const { fire, listeners } = fakeWindow();
    const listener = vi.fn();
    const unsubscribe = subscribeOverviewLayout(listener);
    rememberOverviewLayout("demo_co", standardLayout());
    expect(listener).toHaveBeenCalledTimes(1);
    fire("onebook.dashboard.overview.sample_two");
    fire(null);
    expect(listener).toHaveBeenCalledTimes(3);
    // Another key in the same storage is not a layout.
    fire("onebook.release-notes.seen");
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(listeners.size).toBe(0);
    rememberOverviewLayout("demo_co", standardLayout());
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
