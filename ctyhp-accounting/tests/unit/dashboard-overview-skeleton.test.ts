import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveCompanyProvider, useActiveCompanySlug } from "@/components/ActiveCompanyContext";
import OverviewSkeleton, { skeletonCells } from "@/components/dashboard-home/OverviewSkeleton";
import { presetLayout, standardLayout, toggleShown, toggleWide, type OverviewLayout } from "@/lib/domain/dashboard-home/layout";

/**
 * The dashboard's loading outline follows the Overview the person arranged
 * (3.0.40). Line endings are normalized: this repository is checked out with
 * CRLF on Windows, and a pattern spanning lines must not depend on that.
 */
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the outline's cards", () => {
  it("draws the Standard Overview as before: cash flow wide, then four narrow cards", () => {
    expect(skeletonCells(standardLayout())).toEqual([
      { key: "cash", span: 8, mid: 12, chart: 276 },
      { key: "needs", span: 4, mid: 6, chart: 200 },
      { key: "pnl", span: 4, mid: 6, chart: 190 },
      { key: "expenses", span: 4, mid: 6, chart: 190 },
      { key: "insights", span: 4, mid: 6, chart: 190 },
    ]);
  });

  it("draws one outline per shown card, in the layout's order, as wide as the card", () => {
    expect(skeletonCells(presetLayout("accountant"))).toEqual([
      { key: "bank", span: 8, mid: 12, chart: 190 },
      { key: "needs", span: 4, mid: 6, chart: 200 },
      { key: "close", span: 4, mid: 6, chart: 190 },
      { key: "watchlist", span: 8, mid: 12, chart: 190 },
    ]);
    // A narrow cash flow card draws no taller than its neighbors.
    const narrowCash = toggleWide(standardLayout(), "cash");
    expect(skeletonCells(narrowCash)[0]).toEqual({ key: "cash", span: 4, mid: 6, chart: 190 });
  });

  it("draws nothing when every card is hidden", () => {
    const none: OverviewLayout = standardLayout().shown.reduce((layout, key) => toggleShown(layout, key), standardLayout());
    expect(none.shown).toEqual([]);
    expect(skeletonCells(none)).toEqual([]);
  });

  it("sends the Standard outline from the server, whatever this browser remembers, so hydration matches", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => JSON.stringify(presetLayout("accountant")), setItem: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const html = renderToString(createElement(ActiveCompanyProvider, { slug: "demo_co" }, createElement(OverviewSkeleton)));
    const plain = renderToString(createElement(OverviewSkeleton));
    expect(html).toBe(plain);
    // Five cards, the first one wide, the cash flow chart's 276 in it.
    expect(html.match(/height:276px/g)).toHaveLength(1);
    expect(html.match(/height:200px/g)).toHaveLength(1);
    expect(html.match(/height:190px/g)).toHaveLength(3);
  });
});

describe("where the outline gets its layout", () => {
  const skeleton = read("components/dashboard-home/OverviewSkeleton.tsx");

  it("is a client component reading the remembered layout with useSyncExternalStore, Standard on the server", () => {
    expect(skeleton.startsWith('"use client";')).toBe(true);
    expect(skeleton).toContain("const STANDARD = standardLayout();");
    expect(skeleton).toMatch(/function standardSnapshot\(\): OverviewLayout \{\s*return STANDARD;\s*\}/);
    expect(skeleton).toMatch(
      /useSyncExternalStore\(\s*subscribeOverviewLayout,\s*\(\) => \(slug === null \? null : recallOverviewLayout\(slug\)\) \?\? STANDARD,\s*standardSnapshot,\s*\)/,
    );
    expect(skeleton).toContain("const slug = useActiveCompanySlug();");
  });

  it("is what loading.tsx draws for the cards; everything above them and the tab bar stay as they were", () => {
    const loading = read("app/(app)/dashboard/loading.tsx");
    expect(loading).not.toContain('"use client"');
    expect(loading).toContain('import OverviewSkeleton from "@/components/dashboard-home/OverviewSkeleton";');
    expect(loading).toMatch(/<div className=\{styles\.panel\}>\s*<div className=\{styles\.grid\}>\s*<OverviewSkeleton \/>\s*<\/div>\s*<\/div>/);
    expect(loading).not.toContain("CardShape");
    expect(loading).toContain('{[72, 72, 84, 136].map((width, index) => (');
    expect(loading).toContain('<div role="status" aria-label="Loading the dashboard">');
  });
});

describe("what is remembered, and the company it is remembered for", () => {
  it("the dashboard remembers the saved layout, never the draft", () => {
    const client = read("app/(app)/dashboard/DashboardHomeClient.tsx");
    expect(client).toContain('import { rememberOverviewLayout } from "@/lib/client/dashboard-layout-memory";');
    expect(client).toContain("const slug = useActiveCompanySlug();");
    expect(client).toMatch(
      /useEffect\(\(\) => \{\s*if \(slug !== null && layoutKnown\) rememberOverviewLayout\(slug, layout\);\s*\}, \[slug, layout, layoutKnown\]\);/,
    );
    expect(client.match(/rememberOverviewLayout\(/g)).toHaveLength(1);
    expect(client).not.toMatch(/rememberOverviewLayout\([^)]*\b(draft|overview|next)\b/);
    // Not a Standard layout drawn because the preference could not be read.
    expect(client).toContain("const [layoutKnown, setLayoutKnown] = useState(preference !== null);");
  });

  it("AppShell provides the open company's slug around every page, its loading outline included", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain('import { ActiveCompanyProvider } from "./ActiveCompanyContext";');
    expect(shell).toMatch(
      /<div className="app-shell__content-inner">\s*<ActiveCompanyProvider slug=\{activeCompany\?\.slug \?\? null\}>\{children\}<\/ActiveCompanyProvider>\s*<\/div>/,
    );
    expect(shell.match(/ActiveCompanyProvider/g)).toHaveLength(3);
    const context = read("components/ActiveCompanyContext.tsx");
    expect(context.startsWith('"use client";')).toBe(true);
    expect(context).toContain("export function useActiveCompanySlug(): string | null {");
  });

  it("gives the slug provided, and null outside a company", () => {
    function Probe() {
      return createElement("output", null, useActiveCompanySlug() ?? "no company");
    }
    expect(renderToString(createElement(ActiveCompanyProvider, { slug: "demo_co" }, createElement(Probe)))).toContain("demo_co");
    expect(renderToString(createElement(ActiveCompanyProvider, { slug: null }, createElement(Probe)))).toContain("no company");
    expect(renderToString(createElement(Probe))).toContain("no company");
  });
});
