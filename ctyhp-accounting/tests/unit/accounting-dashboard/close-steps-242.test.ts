import { describe, expect, it } from "vitest";
import {
  closeProgress,
  depreciationStep,
  duplicatesStep,
  futureDatedStep,
  holdingAccountsStep,
  reconciliationsAgreeStep,
  recurringDueStep,
} from "@/lib/domain/accounting-dashboard/close-checklist";

const end = "2026-09-30";

describe("the rest of the design's month-end list (2.42)", () => {
  it("none of them stops the close; each says what is not final yet", () => {
    const steps = [
      holdingAccountsStep({ periodEnd: end, holding: [] }),
      recurringDueStep({ periodEnd: end, activeCount: 1, due: [] }),
      depreciationStep({ periodEnd: end, assetCount: 1, dueCount: 0, dueMinor: 0 }),
      reconciliationsAgreeStep({ periodEnd: end, changed: [] }),
      duplicatesStep({ periodStart: "2026-09-01", periodEnd: end, groups: 0 }),
      futureDatedStep({ today: "2026-10-22", count: 0 }),
    ];
    expect(steps.every((step) => !step.blocksClose)).toBe(true);
    expect(steps.every((step) => step.status === "complete")).toBe(true);
    expect(new Set(steps.map((step) => step.key)).size).toBe(6);
    expect(closeProgress(steps)).toMatchObject({ complete: 6, outstanding: 0, applicable: 6, percent: 100 });
  });

  it("names what still sits in a holding account, and how much", () => {
    const step = holdingAccountsStep({ periodEnd: end, holding: [{ name: "Uncategorized Expense", balanceMinor: 123_400 }] });
    expect(step.status).toBe("outstanding");
    expect(step.evidence).toBe("Uncategorized Expense holds $1,234.00 at 09/30/2026, money not yet coded to where it belongs.");
  });

  it("names the schedules still due, three at most, and is not applicable when nothing recurs", () => {
    const step = recurringDueStep({
      periodEnd: end,
      activeCount: 5,
      due: [{ name: "Rent · $2,000.00" }, { name: "Insurance · $90.00" }, { name: "Retainer · $1,500.00" }, { name: "Phone · $40.00" }],
    });
    expect(step.status).toBe("outstanding");
    expect(step.evidence).toBe("4 schedules are still due: Rent · $2,000.00, Insurance · $90.00, Retainer · $1,500.00 and more.");
    expect(recurringDueStep({ periodEnd: end, activeCount: 0, due: [] }).status).toBe("not-applicable");
  });

  it("says how much depreciation the register worked out that the ledger lacks", () => {
    const step = depreciationStep({ periodEnd: end, assetCount: 3, dueCount: 2, dueMinor: 45_000 });
    expect(step.status).toBe("outstanding");
    expect(step.evidence).toBe("$450.00 of depreciation on 2 assets, for periods ending on or before 09/30/2026, is not in the ledger yet.");
    expect(depreciationStep({ periodEnd: end, assetCount: 0, dueCount: 0, dueMinor: 0 }).status).toBe("not-applicable");
  });

  it("names the signed-off statements that have changed since", () => {
    const step = reconciliationsAgreeStep({ periodEnd: end, changed: [{ accountName: "Operating", statementEndingDate: "2026-08-31" }] });
    expect(step.status).toBe("outstanding");
    expect(step.evidence).toBe("1 signed-off statement has changed since: Operating 08/31/2026.");
  });

  it("asks for matching entries to be looked at, because two real payments can match", () => {
    const step = duplicatesStep({ periodStart: "2026-09-01", periodEnd: end, groups: 2 });
    expect(step.status).toBe("outstanding");
    expect(step.evidence).toContain("2 groups of matching entries. Two real payments can match exactly");
  });

  it("reads one entry, not 1 entrys, and calls a future date a slip in the year", () => {
    expect(futureDatedStep({ today: "2026-10-22", count: 1 }).evidence).toBe("1 entry is dated after today, usually a slip in the year.");
    expect(futureDatedStep({ today: "2026-10-22", count: 3 }).evidence).toBe("3 entries are dated after today, usually a slip in the year.");
  });

  it("a check that could not run is unavailable, never complete", () => {
    expect(holdingAccountsStep({ periodEnd: end, holding: null }).status).toBe("unavailable");
    expect(recurringDueStep({ periodEnd: end, activeCount: null, due: null }).status).toBe("unavailable");
    expect(depreciationStep({ periodEnd: end, assetCount: null, dueCount: 0, dueMinor: 0 }).status).toBe("unavailable");
    expect(reconciliationsAgreeStep({ periodEnd: end, changed: null }).status).toBe("unavailable");
    expect(duplicatesStep({ periodStart: "2026-09-01", periodEnd: end, groups: null }).status).toBe("unavailable");
    expect(futureDatedStep({ today: "2026-10-22", count: null }).status).toBe("unavailable");
  });
});
