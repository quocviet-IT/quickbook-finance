import { describe, expect, it } from "vitest";
import { customerCreditSheet } from "@/app/(app)/reports/customer-credit/credit-sheet";
import { creditStatus } from "@/lib/domain/credit";
import type { CustomerCreditRow } from "@/lib/services/credit";

/** A customer owing `owedMinor` after `soldMinor` was invoiced in a 90-day window. */
function row(name: string, owedMinor: number, soldMinor: number): CustomerCreditRow {
  const input = {
    creditLimitMinor: null,
    creditHold: false,
    openBalanceMinor: owedMinor,
    overdueMinor: owedMinor,
    salesWindowMinor: soldMinor,
    salesWindowDays: 90,
  };
  return {
    name,
    ...input,
    oldestDueDate: null,
    creditTermsDays: 30,
    hasBillingAddress: true,
    status: creditStatus(input),
  } as unknown as CustomerCreditRow;
}

describe("the Customer Credit export", () => {
  it("writes a DSO inside the window as its number of days", () => {
    const sheet = customerCreditSheet([row("Customer A", 3_000_00, 9_000_00)], { companyName: "Test", salesWindowDays: 90 });
    expect(sheet.rows[0].dso).toBe(30);
  });

  it("leaves DSO blank past the window, and says why under the title", () => {
    // Figures in the thousands of days were on screen (follow-up review,
    // 2026-10-29); a spreadsheet should not carry them on.
    const sheet = customerCreditSheet([row("Customer B", 5_000_00, 50_00)], { companyName: "Test", salesWindowDays: 90 });
    expect(sheet.rows[0].dso).toBeNull();
    expect(sheet.subtitle).toContain("DSO is blank where more is owed than was invoiced in the window");
  });
});
