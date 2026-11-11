import { describe, expect, it } from "vitest";
import { guideFlowById, guideLanding, helpHref } from "@/lib/domain/guide-help";

/**
 * 3.0.17: the guide is a page of its own, reached from the left menu and from
 * a Help link on every screen. The link carries only the screen's path — the
 * guide's data stays off every page — and the guide works out the rest.
 */
describe("the Help link on every screen (3.0.17)", () => {
  it("sends the guide the screen it came from", () => {
    expect(helpHref("/invoices")).toBe("/guide?from=%2Finvoices");
  });

  it("drops a record's id, so every invoice shares the invoices help", () => {
    expect(helpHref("/invoices/8f3c2a1b-1111-4222-8333-944455556666")).toBe("/guide?from=%2Finvoices");
  });

  it("is not offered on the guide itself", () => {
    expect(helpHref("/guide")).toBeNull();
    expect(helpHref("/guide/get-paid")).toBeNull();
  });
});

describe("where the guide opens for the screen it came from (3.0.17)", () => {
  it("opens the one guide that covers a screen, rather than a list of one", () => {
    expect(guideLanding("/settings/backups").redirectTo).toBe("/guide/restore-a-backup?from=%2Fsettings%2Fbackups");
  });

  it("opens part-way down a guide that only passes through the screen, at its step", () => {
    // A/R Aging is step 5 of invoicing and getting paid, and nothing else.
    expect(guideLanding("/reports/ar-aging").redirectTo).toBe("/guide/get-paid?from=%2Freports%2Far-aging#step-5");
  });

  it("lists the guides when a screen has several, those that start there first", () => {
    const landing = guideLanding("/invoices");
    expect(landing.redirectTo).toBeNull();
    expect(landing.screen).toBe("Invoices");
    expect(landing.flows.slice(0, 2).map((flow) => flow.id)).toEqual(["get-paid", "correct-a-sale"]);
  });

  it("says plainly when nothing in the guide covers a screen yet", () => {
    const landing = guideLanding("/journal");
    expect(landing.redirectTo).toBeNull();
    expect(landing.flows).toEqual([]);
    expect(landing.screen).toBe("Journal Entries");
  });

  it("ignores a from that is not a screen inside OneBook", () => {
    for (const from of ["https://example.com/x", "//example.com", "javascript:alert(1)", ""]) {
      const landing = guideLanding(from);
      expect(landing.redirectTo, from).toBeNull();
      expect(landing.screen, from).toBeNull();
    }
  });

  it("finds a guide by its id, and nothing for an id it does not know", () => {
    expect(guideFlowById("get-paid")?.title).toBe("Invoice a customer and get paid");
    expect(guideFlowById("no-such-guide")).toBeUndefined();
  });
});
