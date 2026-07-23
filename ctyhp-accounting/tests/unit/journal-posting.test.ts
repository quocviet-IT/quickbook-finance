import { describe, it, expect } from "vitest";
import { buildOpeningBalancePosting } from "@/lib/domain/posting";

describe("buildOpeningBalancePosting", () => {
  it("books the net difference to Opening Balance Equity and balances", () => {
    // Bank 1,000 DR; Loan 400 CR -> net debit 600 -> equity gets 600 CR.
    const lines = buildOpeningBalancePosting(
      [
        { accountId: "bank", debitMinor: 1000_00, creditMinor: 0 },
        { accountId: "loan", debitMinor: 0, creditMinor: 400_00 },
      ],
      "equity",
    );
    const equity = lines.find((l) => l.accountId === "equity");
    expect(equity).toEqual({ accountId: "equity", debitMinor: 0, creditMinor: 600_00, memo: "Opening balance equity" });
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit);
  });

  it("omits the equity line when already balanced", () => {
    const lines = buildOpeningBalancePosting(
      [
        { accountId: "bank", debitMinor: 500_00, creditMinor: 0 },
        { accountId: "loan", debitMinor: 0, creditMinor: 500_00 },
      ],
      "equity",
    );
    expect(lines.find((l) => l.accountId === "equity")).toBeUndefined();
  });
});
