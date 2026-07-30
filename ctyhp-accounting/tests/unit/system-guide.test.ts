import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUIDE_FLOWS,
  GUIDE_NOTICES,
  GUIDE_VERSION,
  guideRoutes,
} from "@/lib/domain/system-guide";

/** Every static route the app actually serves, read from the route folders. */
function appRoutes(dir = join(process.cwd(), "app", "(app)"), prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("[")) continue; // needs a real id, not linkable from a guide
      if (entry.startsWith("(")) {
        routes.push(...appRoutes(full, prefix));
        continue;
      }
      routes.push(...appRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix || "/");
    }
  }
  return routes;
}

describe("guide routes", () => {
  it("only points at pages that exist", () => {
    // A guide that sends a new user to a renamed page is worse than no guide.
    const served = new Set(appRoutes());
    const missing = guideRoutes().filter((route) => !served.has(route));
    expect(missing, `guide links to pages that do not exist: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("covers the modules a first-time user has to touch", () => {
    const routes = guideRoutes();
    for (const expected of [
      "/invoices",
      "/bills",
      "/banking",
      "/settings/periods",
      "/sales-tax",
      "/settings/feedback",
    ]) {
      expect(routes, `no flow reaches ${expected}`).toContain(expected);
    }
  });
});

describe("guide flows", () => {
  it("gives every flow a purpose and at least two steps", () => {
    for (const flow of GUIDE_FLOWS) {
      expect(flow.purpose.length, `${flow.id} has no purpose`).toBeGreaterThan(20);
      expect(flow.steps.length, `${flow.id} has too few steps`).toBeGreaterThanOrEqual(2);
    }
  });

  it("names a control for every step, because that is what the reader looks for", () => {
    for (const flow of GUIDE_FLOWS) {
      for (const step of flow.steps) {
        expect(step.control.trim(), `${flow.id}: a step has no control`).not.toBe("");
        expect(step.action.trim()).not.toBe("");
      }
    }
  });

  it("uses unique flow ids", () => {
    const ids = GUIDE_FLOWS.map((flow) => flow.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("guide notices", () => {
  it("states the version, the test data, and where the design came from", () => {
    expect(GUIDE_VERSION).toBe("1.0");
    expect(GUIDE_NOTICES.map((notice) => notice.id)).toEqual([
      "version",
      "test-data",
      "provenance",
    ]);
  });

  it("says plainly that the figures on screen are not real", () => {
    const testData = GUIDE_NOTICES.find((notice) => notice.id === "test-data");
    expect(testData?.body.toLowerCase()).toContain("test");
    expect(testData?.body.toLowerCase()).toMatch(/not .*(real|actual)/);
  });

  it("promises the workflows will be tuned after this round", () => {
    const provenance = GUIDE_NOTICES.find((notice) => notice.id === "provenance");
    expect(provenance?.body.toLowerCase()).toContain("quickbooks");
    expect(provenance?.body.toLowerCase()).toContain("after this test round");
  });
});
