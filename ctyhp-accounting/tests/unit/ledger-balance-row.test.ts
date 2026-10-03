import { describe, expect, it } from "vitest";
import { ledgerBalanceFromRow } from "@/lib/services/reports";

describe("ledgerBalanceFromRow", () => {
  it("reads one acc_ledger_balances row the way every report does", () => {
    expect(
      ledgerBalanceFromRow({
        account_id: "a1",
        account_code: "1000",
        name: "Example Bank",
        account_type: "bank",
        debit_base: "12345",
        credit_base: 0,
      }),
    ).toEqual({ accountId: "a1", accountCode: "1000", name: "Example Bank", accountType: "bank", debitBase: 12345, creditBase: 0 });
  });
});
