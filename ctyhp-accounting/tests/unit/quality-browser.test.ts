import { describe, expect, it } from "vitest";
import { isAllowedBrowserMethod, safeRequestTarget } from "../../scripts/quality/browser.mjs";
import { classifyViewportSnapshot } from "../../scripts/quality/page-audit.mjs";

describe("quality browser safety", () => {
  it("allows reads and refuses every write transport", () => {
    expect(isAllowedBrowserMethod("GET")).toBe(true);
    expect(isAllowedBrowserMethod("HEAD")).toBe(true);
    expect(isAllowedBrowserMethod("OPTIONS")).toBe(true);
    expect(isAllowedBrowserMethod("POST")).toBe(false);
    expect(isAllowedBrowserMethod("PUT")).toBe(false);
    expect(isAllowedBrowserMethod("PATCH")).toBe(false);
    expect(isAllowedBrowserMethod("DELETE")).toBe(false);
    expect(safeRequestTarget("https://qa.example.test/invoices?token=secret")).toBe("/invoices");
    expect(safeRequestTarget("data:text/html,<p>customer data</p>")).toBe("[non-http-url]");
  });

  it("permits an internal table scroller but reports document overflow", () => {
    expect(classifyViewportSnapshot({
      documentOverflow: 0,
      internalScrollers: 1,
      clippedTargets: [],
      shellOverlaps: [],
    }).findings).toHaveLength(0);
    expect(classifyViewportSnapshot({
      documentOverflow: 14,
      internalScrollers: 1,
      clippedTargets: [],
      shellOverlaps: [],
    }).findings[0].rule).toBe("document-overflow");
    expect(classifyViewportSnapshot({
      documentOverflow: 0,
      internalScrollers: 0,
      clippedTargets: [],
      shellOverlaps: ["#primary-action"],
    }).findings[0].rule).toBe("fixed-shell-overlap");
  });
});
