import { describe, expect, it } from "vitest";
import { knownScreenName, screenName, screenPath } from "@/lib/domain/screen-names";
import { guideKnownRoutes } from "@/lib/domain/screen-context";

/**
 * 3.0.17: the guide says "Starts on Bank Transactions", never "starts at
 * /banking". A path is how the code finds a screen; a name is how a person does.
 */
describe("the name a person knows a screen by (3.0.17)", () => {
  it("names every screen the guide sends anybody to", () => {
    // A route with no name of its own would fall back to a word made from the
    // path. That reads well enough to slip through review and wrong enough to
    // send someone looking for a menu entry that does not exist.
    const unnamed = guideKnownRoutes().filter((route) => knownScreenName(route) === null);
    expect(unnamed).toEqual([]);
  });

  it("uses the sidebar's own words", () => {
    expect(screenName("/banking")).toBe("Bank Transactions");
    expect(screenName("/invoices")).toBe("Invoices");
    expect(screenName("/dashboard")).toBe("Dashboard");
  });

  it("tells one Overview from another by its group", () => {
    expect(screenName("/banking/overview")).toBe("Banking overview");
    expect(screenName("/sales")).toBe("Sales overview");
  });

  it("uses the settings hub's titles", () => {
    expect(screenName("/settings/periods")).toBe("Accounting periods");
  });

  it("uses the report centre's titles", () => {
    expect(screenName("/reports/cash-flow-forecast")).toBe("13 Week Cash Forecast");
  });

  it("names a record's page by the list it belongs to", () => {
    expect(screenName("/invoices/8f3c2a1b-1111-4222-8333-944455556666")).toBe("Invoices");
  });

  it("never shows a path, even for a screen it does not know yet", () => {
    expect(knownScreenName("/some-new/screen-here")).toBeNull();
    expect(screenName("/some-new/screen-here")).toBe("Screen here");
  });
});

describe("the menu path to a screen (Abacus)", () => {
  it("puts a sidebar group before its page", () => {
    expect(screenPath("/banking")).toBe("Banking › Bank Transactions");
    expect(screenPath("/invoices")).toBe("Sales › Invoices");
    expect(screenPath("/banking/overview")).toBe("Banking › Overview");
  });

  it("gives a top-level page its label alone", () => {
    expect(screenPath("/dashboard")).toBe("Dashboard");
  });

  it("puts settings and reports under their own headings", () => {
    expect(screenPath("/settings/periods")).toBe("Settings › Accounting periods");
    expect(screenPath("/reports/cash-flow-forecast")).toBe("Reports › 13 Week Cash Forecast");
  });

  it("gives a screen no menu holds its name", () => {
    expect(screenPath("/guide")).toBe("Guide");
    expect(screenPath("/some-new/screen-here")).toBe("Screen here");
  });

  it("follows a record's page to its list", () => {
    expect(screenPath("/invoices/8f3c2a1b-1111-4222-8333-944455556666")).toBe("Sales › Invoices");
  });
});
