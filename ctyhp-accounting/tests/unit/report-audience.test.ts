import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REPORT_AUDIENCE,
  getReportAudience,
  REPORT_AUDIENCES,
  reportAudienceLabel,
  reportAudienceServerSnapshot,
  setReportAudience,
} from "@/lib/client/report-audience";

const KEY = "ctyhp.reports.audience";

function stubWindow(store: Map<string, string>, options: { throws?: boolean } = {}) {
  vi.stubGlobal("window", {
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

describe("report audience", () => {
  it("offers exactly the two the toggle shows", () => {
    expect(REPORT_AUDIENCES).toEqual(["accountant", "management"]);
    expect(reportAudienceLabel("accountant")).toBe("Accountant");
    expect(reportAudienceLabel("management")).toBe("Management");
  });

  it("defaults to the accountant, because this is an accounting product", () => {
    expect(DEFAULT_REPORT_AUDIENCE).toBe("accountant");
    stubWindow(new Map());
    expect(getReportAudience()).toBe("accountant");
    expect(reportAudienceServerSnapshot()).toBe("accountant");
  });

  it("remembers the choice", () => {
    const store = new Map<string, string>();
    stubWindow(store);
    setReportAudience("management");
    expect(store.get(KEY)).toBe("management");
    expect(getReportAudience()).toBe("management");

    setReportAudience("accountant");
    expect(getReportAudience()).toBe("accountant");
  });

  it("treats anything else stored as the default rather than trusting it", () => {
    stubWindow(new Map([[KEY, "cfo"]]));
    expect(getReportAudience()).toBe("accountant");
  });

  it("still works where localStorage throws, it just forgets", () => {
    stubWindow(new Map(), { throws: true });
    expect(() => setReportAudience("management")).not.toThrow();
    expect(getReportAudience()).toBe("accountant");
  });

  it("reads as the default on the server, where there is no window", () => {
    expect(getReportAudience()).toBe("accountant");
  });
});
