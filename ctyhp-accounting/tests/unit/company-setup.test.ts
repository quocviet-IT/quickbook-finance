import { describe, expect, it } from "vitest";
import {
  companySetupSteps,
  setupProgress,
  setupProgressLabel,
  type CompanySetupFacts,
} from "@/lib/domain/company-setup";

/** A company set up end to end: the baseline each case changes one thing in. */
const ready: CompanySetupFacts = {
  settings: {
    savedByPerson: true,
    hasAddress: true,
    hasContact: true,
    timeZone: "America/Los_Angeles",
    fiscalYearStartMonth: 1,
  },
  openingBalanceDate: "2026-01-01",
  firstEntryDate: "2026-01-01",
  postedEntries: 120,
  bankAccounts: 2,
  people: 3,
};

const step = (facts: CompanySetupFacts, key: string) => companySetupSteps(facts).find((s) => s.key === key)!;

describe("companySetupSteps", () => {
  it("lists the four steps in the order they are best done", () => {
    expect(companySetupSteps(ready).map((s) => s.key)).toEqual(["details", "opening", "bank", "people"]);
  });

  it("calls a company with every step done complete", () => {
    const steps = companySetupSteps(ready);
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(setupProgress(steps)).toEqual({ done: 4, check: 0, total: 4, complete: true });
    expect(step(ready, "details").detail).toBe("Saved. Dates are read in Pacific Time, and the fiscal year starts in January.");
  });

  it("says settings that were never saved leave the documents bare and the defaults unchosen", () => {
    const details = step({ ...ready, settings: null }, "details");
    expect(details.state).toBe("todo");
    expect(details.detail).toMatch(/^Never saved\./);
    expect(details.detail).toContain("Eastern Time");
  });

  it("does not count the settings written when the company was created as saved", () => {
    const details = step({ ...ready, settings: { ...ready.settings!, savedByPerson: false, timeZone: "America/New_York" } }, "details");
    expect(details.state).toBe("todo");
    expect(details.detail).toContain("only the name the company was created under");
    expect(details.detail).toContain("(Eastern Time)");
  });

  it("names what a saved company still lacks for its documents", () => {
    const noContact = step({ ...ready, settings: { ...ready.settings!, hasContact: false } }, "details");
    expect([noContact.state, noContact.detail]).toEqual([
      "todo",
      "Saved without a phone or an email. Invoices, estimates and sales receipts print what is saved here.",
    ]);
    const neither = step({ ...ready, settings: { ...ready.settings!, hasContact: false, hasAddress: false } }, "details");
    expect(neither.detail).toMatch(/^Saved without an address, phone or email\./);
    const noAddress = step({ ...ready, settings: { ...ready.settings!, hasAddress: false } }, "details");
    expect(noAddress.detail).toMatch(/^Saved without an address\./);
  });

  it("asks for a check, not a fix, when the books started without an opening balance", () => {
    // Every company in use began this way: its first entries carry the balances,
    // or the business began with nothing. The books cannot tell which.
    const opening = step({ ...ready, openingBalanceDate: null, firstEntryDate: "2025-01-02", postedEntries: 5110 }, "opening");
    expect(opening.state).toBe("check");
    expect(opening.detail).toBe(
      "The books start on 01/02/2025, with 5,110 posted entries, none of them from Opening Balances. If the accounts held money before that day, enter it there.",
    );
  });

  it("leaves opening balances to do while nothing is posted", () => {
    const opening = step({ ...ready, openingBalanceDate: null, firstEntryDate: null, postedEntries: 0 }, "opening");
    expect(opening.state).toBe("todo");
    expect(opening.href).toBe("/opening-balances");
  });

  it("counts bank accounts and people with their nouns agreeing", () => {
    expect(step({ ...ready, bankAccounts: 1 }, "bank").detail).toBe("1 account set up in Banking.");
    expect(step({ ...ready, bankAccounts: 0 }, "bank").state).toBe("todo");
    expect(step({ ...ready, people: 2 }, "people").detail).toBe("2 people have an account in these books.");
    expect(step({ ...ready, people: 1 }, "people").state).toBe("todo");
  });
});

describe("setupProgressLabel", () => {
  it("says how many are done, and how many are left to check when any are", () => {
    const steps = companySetupSteps({ ...ready, openingBalanceDate: null, bankAccounts: 0 });
    expect(setupProgressLabel(setupProgress(steps))).toBe("2 of 4 done, 1 to check");
    expect(setupProgressLabel(setupProgress(companySetupSteps(ready)))).toBe("4 of 4 done");
  });
});
