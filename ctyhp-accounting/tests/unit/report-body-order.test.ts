import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportBody } from "@/components/reports/ReportAudience";
import { DEFAULT_REPORT_AUDIENCE } from "@/lib/client/report-audience";

/**
 * The Balance Sheet's bank and cash panel came after the whole body, so in the
 * Accountant view it sat under the chart. A reviewer looking for it concluded
 * it was only in Management (feature check, 2026-10-20).
 */
describe("what reads beside a report's figures", () => {
  const html = renderToString(
    createElement(ReportBody, {
      numbers: createElement("p", null, "FIGURES"),
      besideNumbers: createElement("p", null, "BANKS"),
      chart: createElement("p", null, "CHART"),
    }),
  );

  it("follows the figures, before the chart, in the Accountant view", () => {
    expect(DEFAULT_REPORT_AUDIENCE).toBe("accountant");
    expect(html.indexOf("FIGURES")).toBeLessThan(html.indexOf("BANKS"));
    expect(html.indexOf("BANKS")).toBeLessThan(html.indexOf("CHART"));
  });

  it("follows the figures in the Management view too", () => {
    const source = readFileSync(join(process.cwd(), "components/reports/ReportAudience.tsx"), "utf8");
    expect(source).toMatch(/\{chart\}\s*<div style=\{\{ marginTop: 24 \}\}>\{numbers\}<\/div>\s*\{besideNumbers\}/);
  });

  it("is where the Balance Sheet puts its bank and cash panel", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/reports/ReportsClient.tsx"), "utf8");
    expect(source).toContain("besideNumbers={banksPanel}");
  });
});
