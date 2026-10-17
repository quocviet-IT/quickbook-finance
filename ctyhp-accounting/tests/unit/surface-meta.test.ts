import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sectionFreshnessNote,
  sectionIsStale,
  summarizeSections,
  surfaceFacts,
  surfaceSections,
  type SurfaceSectionState,
} from "@/lib/domain/work-surface/surface-meta";
import { STALE_AFTER_MS } from "@/lib/domain/work-surface/freshness";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.parse("2026-10-17T13:34:00Z");
const fresh = "2026-10-17T13:33:00Z";
const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();

const OVERVIEWS = [
  { page: "app/(app)/sales/page.tsx", surface: "components/sales-surface/SalesSurface.tsx" },
  { page: "app/(app)/purchases/page.tsx", surface: "components/purchases-surface/PurchasesSurface.tsx" },
  { page: "app/(app)/banking/overview/page.tsx", surface: "components/banking-surface/BankingSurface.tsx" },
  { page: "app/(app)/inventory/page.tsx", surface: "components/inventory-surface/InventorySurface.tsx" },
];

describe("the facts under an overview's subtitle", () => {
  it("say the date, the currency and the zone by name", () => {
    expect(surfaceFacts({ asOf: "2026-10-17", currencyCode: "USD", timeZone: "America/New_York" })).toEqual([
      "As of 10/17/2026",
      "USD",
      "Eastern Time",
    ]);
  });

  it("take only the state of the two sections, not their rows", () => {
    const sections = surfaceSections({
      queue: { data: [{ id: "x" }], generatedAt: fresh, dataState: "fresh" },
      controls: { data: null, generatedAt: fresh, dataState: "unavailable", unavailableReason: "no" },
    });
    expect(sections).toEqual([
      { name: "Work", generatedAt: fresh, dataState: "fresh" },
      { name: "Checks", generatedAt: fresh, dataState: "unavailable" },
    ]);
  });

  it("print the latest time once, and name the stale and missing sections", () => {
    const sections: SurfaceSectionState[] = [
      { name: "Work", generatedAt: old, dataState: "fresh" },
      { name: "Checks", generatedAt: fresh, dataState: "unavailable" },
    ];
    expect(summarizeSections(sections, NOW)).toEqual({ stale: ["Work"], unavailable: ["Checks"], generatedAt: fresh });
    expect(summarizeSections([], NOW).generatedAt).toBeNull();
  });

  it("count a section the server already called stale as stale", () => {
    expect(sectionIsStale({ generatedAt: fresh, dataState: "stale" }, NOW)).toBe(true);
    expect(sectionIsStale({ generatedAt: fresh, dataState: "fresh" }, NOW)).toBe(false);
    expect(sectionIsStale({ generatedAt: old, dataState: "unavailable" }, NOW)).toBe(false);
  });
});

describe("a section's own Computed at note", () => {
  it("shows on Accounting as before", () => {
    expect(sectionFreshnessNote({ generatedAt: fresh, dataState: "fresh" }, "always", NOW)).toBe("fresh");
  });

  it("is left out on an overview while the figures are fresh, and says stale when they are not", () => {
    expect(sectionFreshnessNote({ generatedAt: fresh, dataState: "fresh" }, "when-stale", NOW)).toBeNull();
    expect(sectionFreshnessNote({ generatedAt: old, dataState: "fresh" }, "when-stale", NOW)).toBe("stale");
  });
});

describe("the four overviews", () => {
  it("hand the facts to the page header, so they read as part of the subtitle", () => {
    for (const { page } of OVERVIEWS) {
      expect(read(page), page).toContain(
        "meta={<SurfaceMeta facts={surfaceFacts(data.context)} sections={surfaceSections(data)} timeZone={data.context.timeZone} />}",
      );
    }
  });

  it("no longer draw a boxed strip of their own", () => {
    expect(existsSync(join(process.cwd(), "components/work-surface/SurfaceStatusStrip.tsx"))).toBe(false);
    const screen = read("components/work-surface/SurfaceScreen.tsx");
    expect(screen).not.toMatch(/<SurfaceStatusStrip|import SurfaceStatusStrip|facts=\{|\bfacts: readonly/);
    for (const { surface } of OVERVIEWS) expect(read(surface), surface).not.toContain("facts=");
  });

  it("repeat the time in their sections only when stale, and leave Accounting's alone", () => {
    const screen = read("components/work-surface/SurfaceScreen.tsx");
    expect(screen.match(/freshness="when-stale"/g)).toHaveLength(2);
    for (const path of ["components/accounting-dashboard/ControlHealthPanel.tsx", "components/accounting-dashboard/PriorityWorkQueue.tsx"]) {
      expect(read(path), path).not.toContain("freshness=");
    }
  });
});
