import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, normalBalanceOf, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { accountNames } from "@/lib/domain/beancount";
import { cashFlowCategoryOf, defaultCashFlowRole } from "@/lib/domain/cashflow";
import { translateAccountType } from "@/lib/domain/import-mapping";
import { buildBalanceSheet, type LedgerBalance } from "@/lib/domain/reports";
import { balanceSheetStatement, indexAccounts, type StatementColumn } from "@/lib/domain/statement";

const ACCOUNTS = indexAccounts([
  { id: "cash", code: "1000", name: "Cash", type: "bank", parentId: null },
  { id: "ap", code: "2000", name: "Accounts Payable", type: "accounts_payable", parentId: null },
  { id: "loan", code: "2500", name: "Long-Term Loans Payable", type: "long_term_liability", parentId: null },
  { id: "owner", code: "3000", name: "Owner's Capital", type: "equity", parentId: null },
]);
const bal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};
const COLUMN: StatementColumn = { key: "current", label: "Jun 30, 2026", sub: "", from: null, to: "2026-06-30", isTotal: false };
const sheet = (rows: LedgerBalance[]) =>
  balanceSheetStatement({
    columns: [COLUMN],
    sheets: [buildBalanceSheet(rows)],
    priorEarnings: [0],
    fiscalYearStarts: ["2026-01-01"],
    accounts: ACCOUNTS,
    change: false,
  });
const amount = (s: ReturnType<typeof sheet>, key: string) => s.rows.find((r) => r.key === key)?.cells[0].amount;

describe("the non-current liability type", () => {
  it("sits after current liabilities, is credit-normal and on the balance sheet", () => {
    expect(ACCOUNT_TYPES.indexOf("long_term_liability")).toBe(ACCOUNT_TYPES.indexOf("current_liability") + 1);
    expect(ACCOUNT_TYPE_LABEL.long_term_liability).toBe("Long-term Liability");
    expect(normalBalanceOf("long_term_liability")).toBe("credit");
    expect(statementSectionOf("long_term_liability")).toBe("balance_sheet");
  });

  it("is financing on the cash flow statement and Liabilities:LongTerm in Beancount", () => {
    expect(defaultCashFlowRole("long_term_liability")).toBe("financing");
    expect(cashFlowCategoryOf("long_term_liability")).toBe("financing");
    const names = accountNames([{ id: "loan", code: "2500", name: "Long-Term Loans Payable", type: "long_term_liability" as AccountType }]);
    expect(names.get("loan")).toMatch(/^Liabilities:LongTerm:/);
  });

  it("is what an import's long-term liabilities become", () => {
    expect(translateAccountType("Long Term Liabilities")).toBe("long_term_liability");
    expect(translateAccountType("Notes Payable")).toBe("long_term_liability");
    expect(translateAccountType("Other Current Liabilities")).toBe("current_liability");
  });

  it("counts in total liabilities and gets its own group on the balance sheet", () => {
    const rows = [bal("cash", 1_500_000, 0), bal("ap", 0, 200_000), bal("loan", 0, 1_000_000), bal("owner", 0, 300_000)];
    const built = buildBalanceSheet(rows);
    expect(built.totalLiabilities).toBe(1_200_000);
    expect(built.balanced).toBe(true);
    const s = sheet(rows);
    expect(amount(s, "liabilities:current:total")).toBe(200_000);
    expect(s.rows.find((r) => r.key === "liabilities:long")?.kind).toBe("classhead");
    expect(amount(s, "liabilities:long:total")).toBe(1_000_000);
    expect(amount(s, "liabilities:total")).toBe(1_200_000);
  });

  it("shows no long-term group when there is nothing long-term", () => {
    const s = sheet([bal("cash", 200_000, 0), bal("ap", 0, 200_000)]);
    expect(s.rows.some((r) => r.key === "liabilities:long")).toBe(false);
    expect(amount(s, "liabilities:current:total")).toBe(200_000);
  });
});
