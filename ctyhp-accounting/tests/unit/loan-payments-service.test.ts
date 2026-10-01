import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLoanMovements, loanAccountIds, postLoanPayment } from "@/lib/services/loan-payments";

const entry = (id: string, kind: "card" | "loan", accountId: string, isActive = true) => ({
  id,
  kind,
  accountId,
  matchWords: "x",
  matchDigits: null,
  interestAccountId: kind === "loan" ? "int" : null,
  interestMethod: kind === "loan" ? ("rate" as const) : null,
  annualRate: kind === "loan" ? 4 : null,
  fixedInterestMinor: null,
  isActive,
});

describe("loanAccountIds", () => {
  it("names each switched-on loan's account once", () => {
    expect(loanAccountIds([entry("a", "loan", "L1"), entry("b", "card", "C1"), entry("c", "loan", "L2", false), entry("d", "loan", "L1")])).toEqual(["L1"]);
  });
});

describe("loadLoanMovements", () => {
  it("reads nothing when there is no loan", async () => {
    const from = vi.fn();
    expect(await loadLoanMovements({ from } as unknown as SupabaseClient, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
  it("pages posted lines on the loan accounts and keeps the entry date", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ id: "l1", account_id: "L1", debit_minor: 0, credit_minor: 12_000_000, acc_journal_entry: { entry_date: "2026-01-01", status: "posted" } }],
      error: null,
    });
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const inFn = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    expect(await loadLoanMovements({ from } as unknown as SupabaseClient, ["L1"])).toEqual([
      { accountId: "L1", date: "2026-01-01", debitMinor: 0, creditMinor: 12_000_000 },
    ]);
    expect(from).toHaveBeenCalledWith("acc_journal_line");
    expect(inFn).toHaveBeenCalledWith("account_id", ["L1"]);
    expect(eq).toHaveBeenCalledWith("acc_journal_entry.status", "posted");
    expect(order).toHaveBeenCalledWith("id");
  });
});

describe("postLoanPayment", () => {
  it("passes only the line, the entry and the interest, and returns what was posted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { entry_number: "JE-000031", principal_minor: 160_000, interest_minor: 40_000 }, error: null });
    expect(await postLoanPayment({ rpc } as unknown as SupabaseClient, "t1", "rp1", 40_000)).toEqual({
      entry_number: "JE-000031",
      principal_minor: 160_000,
      interest_minor: 40_000,
    });
    expect(rpc).toHaveBeenCalledWith("acc_post_bank_loan_payment", { p_transaction_id: "t1", p_repayment_id: "rp1", p_interest_minor: 40_000 });
  });
  it("reports the database's refusal word for word", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Interest must be between 0 and the payment" } });
    await expect(postLoanPayment({ rpc } as unknown as SupabaseClient, "t1", "rp1", 999_999)).rejects.toThrow("Interest must be between 0 and the payment");
  });
});
