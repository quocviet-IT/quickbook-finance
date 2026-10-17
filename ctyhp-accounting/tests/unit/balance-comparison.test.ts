import { describe, expect, it } from "vitest";
import {
  BALANCE_BASIS_NOTE,
  balanceComparisonHeading,
  balanceComparisonSheet,
  buildComparison,
  checkNewExternal,
  comparisonGroupOf,
  draftLines,
  draftProblem,
  externalRowKey,
  formatFigureText,
  hydrateSaved,
  isRealIsoDate,
  nearestSavedDate,
  nothingTypedMessage,
  parseExternalBalance,
  savedMessage,
  LOAD_FAILED,
  NO_DIFFERENCES,
  sideOfGroup,
  tableLines,
  type ComparisonAccount,
} from "@/lib/domain/balance-comparison";

const acct = (
  id: string,
  code: string,
  name: string,
  type: ComparisonAccount["type"],
  extra: Partial<ComparisonAccount> = {},
): ComparisonAccount => ({ id, code, name, type, isContra: false, active: true, ...extra });

const ACCOUNTS: ComparisonAccount[] = [
  acct("bank", "1010", "Harbor Checking", "bank"),
  acct("ar", "1200", "Trade Receivables", "accounts_receivable"),
  acct("dep", "1590", "Accumulated Wear", "fixed_asset", { isContra: true }),
  acct("ap", "2000", "Trade Payables", "accounts_payable"),
  acct("loan", "2500", "Term Loan", "long_term_liability"),
  acct("cap", "3000", "Owner Capital", "equity"),
  acct("sales", "4000", "Product Sales", "income"),
  acct("rent", "6100", "Premises Rent", "expense"),
  acct("never", "6900", "Never Posted", "expense"),
  acct("old", "6950", "Retired Fees", "expense", { active: false }),
];

const FIGURES: Record<string, number> = {
  bank: 1_000_00,
  ar: 250_00,
  dep: 40_00,
  ap: 300_00,
  loan: 2_000_00,
  cap: 500_00,
  sales: 900_00,
  rent: 120_00,
  old: 15_00,
};

describe("parseExternalBalance", () => {
  const debit = (raw: string) => parseExternalBalance(raw, "debit");
  const credit = (raw: string) => parseExternalBalance(raw, "credit");

  it.each([
    ["1,234.56", 123456],
    ["1234.56", 123456],
    ["$1,234.56", 123456],
    ["  $ 1,234.56  ", 123456],
    ["1,234", 123400],
    [".5", 50],
    ["7", 700],
    ["0", 0],
    ["(1,234.56)", -123456],
    ["($1,234.56)", -123456],
    ["$(1,234.56)", -123456],
    ["-1,234.56", -123456],
    ["-$1,234.56", -123456],
    ["$-1,234.56", -123456],
    ["1,234.56-", -123456],
    ["−1,234.56", -123456],
    ["1,234.56−", -123456],
    [" $1,234.56 ", 123456],
    ["+1,234.56", 123456],
  ])("reads %j as %i", (raw, minor) => {
    expect(debit(raw)).toEqual({ ok: true, minor });
  });

  it("reads minus zero as zero", () => {
    expect(debit("-0.00")).toEqual({ ok: true, minor: 0 });
    expect(Object.is((debit("(0)") as { minor: number }).minor, -0)).toBe(false);
  });

  it("makes CR negative for a debit-natural account and DR negative for a credit-natural one", () => {
    expect(debit("1,234.56 CR")).toEqual({ ok: true, minor: -123456 });
    expect(debit("1,234.56CR")).toEqual({ ok: true, minor: -123456 });
    expect(debit("1,234.56 cr")).toEqual({ ok: true, minor: -123456 });
    expect(debit("1,234.56 DR")).toEqual({ ok: true, minor: 123456 });
    expect(credit("1,234.56 DR")).toEqual({ ok: true, minor: -123456 });
    expect(credit("1,234.56 CR")).toEqual({ ok: true, minor: 123456 });
    expect(debit("1,234.56 CR")).toEqual({ ok: true, minor: -123456 });
    expect(debit("$1,234.56 CR")).toEqual({ ok: true, minor: -123456 });
  });

  it("treats a blank box as no figure, never zero", () => {
    expect(debit("")).toEqual({ ok: true, minor: null });
    expect(debit("   ")).toEqual({ ok: true, minor: null });
    expect(debit(" ")).toEqual({ ok: true, minor: null });
    expect(debit("0")).toEqual({ ok: true, minor: 0 });
  });

  it.each(["abc", "12abc", "1,23", "1.234", "5.", "--5", "(5)-", "(1,234.56) CR", "1.234,56", "$", "-", "()", "1 234.56", "NaN", "1e5", "12 34"])(
    "refuses %j with a message that names it, and never reads it as zero",
    (raw) => {
      const result = debit(raw);
      expect(result).toEqual({ ok: false, error: `Not a number: ${raw.trim()}` });
    },
  );

  it("honors the currency's decimal places", () => {
    expect(parseExternalBalance("1,234", "debit", 0)).toEqual({ ok: true, minor: 1234 });
    expect(parseExternalBalance("1.5", "debit", 0)).toEqual({ ok: false, error: "Not a number: 1.5" });
    expect(parseExternalBalance("1.234", "debit", 3)).toEqual({ ok: true, minor: 1234 });
  });

  it("refuses a figure too large to hold exactly", () => {
    expect(debit("99,999,999,999,999,999.99").ok).toBe(false);
  });
});

describe("natural sign", () => {
  it("reads every row on its group's side, as a balance sheet prints it", () => {
    const c = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed: {}, externals: [] });
    const sides = Object.fromEntries(c.groups.flatMap((g) => g.rows.map((r) => [r.accountId, r.side])));
    expect(sides).toMatchObject({ bank: "debit", ap: "credit", cap: "credit", sales: "credit", rent: "debit", dep: "debit" });
  });

  it("groups other income with income and cost of goods sold with expenses", () => {
    expect(comparisonGroupOf("other_income")).toBe("income");
    expect(comparisonGroupOf("cost_of_goods_sold")).toBe("expense");
    expect(comparisonGroupOf("credit_card")).toBe("liability");
    expect(sideOfGroup("liability")).toBe("credit");
    expect(sideOfGroup("expense")).toBe("debit");
  });
});

describe("contra accounts carry their section's sign", () => {
  const accounts = [
    acct("bank", "1000", "Cash", "bank"),
    acct("dep", "1500", "Accumulated Wear", "fixed_asset", { isContra: true }),
    acct("sales", "4000", "Sales", "income"),
    acct("disc", "4900", "Sales Discounts", "income", { isContra: true }),
  ];
  // The Chart of Accounts reads a contra account on its own side: positive when it holds its usual balance.
  const figures = { bank: 1_000_00, dep: 5_000, sales: 800_00, disc: 20_00 };

  it("shows Accumulated Depreciation negative under Assets, and a contra-income account negative under Income", () => {
    const c = buildComparison({ accounts, figures, typed: {}, externals: [] });
    expect(c.groups[0].rows.find((r) => r.accountId === "dep")).toMatchObject({ onebookMinor: -5_000, side: "debit" });
    expect(c.groups[3].rows.find((r) => r.accountId === "disc")).toMatchObject({ onebookMinor: -20_00, side: "credit" });
    expect(c.groups[0].totals.onebookMinor).toBe(1_000_00 - 5_000);
    expect(c.groups[3].totals.onebookMinor).toBe(800_00 - 20_00);
  });

  it("gives no difference when its printed negative is typed, and reads CR on the section's side", () => {
    const typed = {
      "a:dep": (parseExternalBalance("(50.00)", "debit") as { minor: number }).minor,
      "a:disc": (parseExternalBalance("20.00 DR", "credit") as { minor: number }).minor,
    };
    expect(typed).toEqual({ "a:dep": -5_000, "a:disc": -20_00 });
    const c = buildComparison({ accounts, figures, typed, externals: [] });
    expect(c.groups[0].rows[1].differenceMinor).toBe(0);
    expect(c.groups[3].rows[1].differenceMinor).toBe(0);
    expect(c.differenceCount).toBe(0);
    // CR on a debit-section row is negative: the same figure a balance sheet prints in brackets.
    expect(parseExternalBalance("50.00 CR", "debit")).toEqual({ ok: true, minor: -5_000 });
  });

  it("still totals nil, debits less credits, on a balanced ledger that includes contra accounts", () => {
    // Debits: cash 1,000.00 and rent 50.00; credits: wear 50.00 (a credit balance), capital 800.00, sales 200.00.
    const bal = [
      acct("bank", "1000", "Cash", "bank"),
      acct("dep", "1500", "Accumulated Wear", "fixed_asset", { isContra: true }),
      acct("cap", "3000", "Capital", "equity"),
      acct("sales", "4000", "Sales", "income"),
      acct("rent", "6000", "Rent", "expense"),
    ];
    const c = buildComparison({
      accounts: bal,
      figures: { bank: 1_000_00, dep: 50_00, cap: 800_00, sales: 200_00, rent: 50_00 },
      typed: {},
      externals: [],
    });
    expect(c.grand.onebookMinor).toBe(0);
  });
});

describe("buildComparison", () => {
  const build = (typed: Record<string, number | null>, externals = [] as ReturnType<typeof hydrateSaved>["externals"]) =>
    buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed, externals });

  it("lists every active account in the five groups, in chart order, at nil when never posted to", () => {
    const c = build({});
    expect(c.groups.map((g) => g.title)).toEqual(["Assets", "Liabilities", "Equity", "Income", "Expenses"]);
    expect(c.groups[0].rows.map((r) => r.code)).toEqual(["1010", "1200", "1590"]);
    expect(c.groups[1].rows.map((r) => r.code)).toEqual(["2000", "2500"]);
    const expenses = c.groups[4].rows;
    expect(expenses.map((r) => r.code)).toEqual(["6100", "6900", "6950"]); // 6950 is inactive but still holds a balance
    expect(expenses[1]).toMatchObject({ name: "Never Posted", onebookMinor: 0, otherMinor: null, differenceMinor: null });
  });

  it("shows an inactive account that still holds a balance, counted in the totals, and hides one at nil", () => {
    const c = build({});
    const old = c.groups[4].rows.find((r) => r.accountId === "old");
    expect(old).toMatchObject({ inactive: true, onebookMinor: 15_00, otherMinor: null });
    expect(c.groups[4].totals.onebookMinor).toBe(120_00 + 15_00);
    const quiet = buildComparison({ accounts: ACCOUNTS, figures: { ...FIGURES, old: 0 }, typed: {}, externals: [] });
    expect(quiet.groups[4].rows.some((r) => r.accountId === "old")).toBe(false);
  });

  it("leaves out an inactive account at nil unless a saved figure still points at it", () => {
    const nil = { ...FIGURES, old: 0 };
    expect(buildComparison({ accounts: ACCOUNTS, figures: nil, typed: {}, externals: [] }).groups[4].rows.some((r) => r.accountId === "old")).toBe(false);
    const withSaved = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed: { "a:old": 10_00 }, externals: [] });
    const row = withSaved.groups[4].rows.find((r) => r.accountId === "old")!;
    expect(row).toMatchObject({ inactive: true, onebookMinor: 15_00, otherMinor: 10_00, differenceMinor: 5_00 });
  });

  it("shows a difference only when a figure is typed, and as OneBook minus the other system", () => {
    const c = build({ "a:bank": 900_00, "a:ap": 350_00, "a:ar": 250_00 });
    const bank = c.groups[0].rows[0];
    expect(bank).toMatchObject({ otherMinor: 900_00, differenceMinor: 100_00 });
    expect(c.groups[1].rows[0].differenceMinor).toBe(-50_00);
    expect(c.groups[0].rows[1].differenceMinor).toBe(0);
    expect(c.groups[0].rows[2].differenceMinor).toBeNull();
  });

  it("totals each group and the whole report from what is shown", () => {
    const c = build({ "a:bank": 900_00, "a:ar": 250_00, "a:ap": 350_00 });
    const [assets, liabilities, equity] = c.groups;
    expect(assets.totals).toEqual({ onebookMinor: 1_000_00 + 250_00 - 40_00, otherMinor: 1_150_00, differenceMinor: 100_00 });
    expect(liabilities.totals).toEqual({ onebookMinor: 2_300_00, otherMinor: 350_00, differenceMinor: -50_00 });
    expect(equity.totals).toEqual({ onebookMinor: 500_00, otherMinor: null, differenceMinor: null });
    // Debits less credits: assets and expenses minus liabilities, equity and income, each row on its own side.
    expect(c.grand).toEqual({
      onebookMinor: 1_000_00 + 250_00 + 120_00 + 15_00 - (40_00 + 300_00 + 2_000_00 + 500_00 + 900_00),
      otherMinor: 900_00 + 250_00 - 350_00,
      differenceMinor: 100_00 + 0 - -50_00,
    });
    expect(c.typedCount).toBe(3);
    expect(c.differenceCount).toBe(2);
  });

  it("counts a typed zero as a figure, and a blank as none", () => {
    const c = build({ "a:never": 0, "a:rent": null });
    expect(c.groups[4].rows[1]).toMatchObject({ otherMinor: 0, differenceMinor: 0 });
    expect(c.groups[4].rows[0]).toMatchObject({ otherMinor: null, differenceMinor: null });
    expect(c.typedCount).toBe(1);
  });

  it("puts an account only the other system has at the end of its group, at nil for OneBook", () => {
    const ext = [
      { key: externalRowKey("2900"), code: "2900", name: "Customer Deposits", group: "liability" as const },
      { key: externalRowKey("6999"), code: "6999", name: "Misc Charges", group: "expense" as const },
    ];
    const c = build({ [ext[0].key]: 75_00, [ext[1].key]: 5_00 }, ext);
    const liabilities = c.groups[1].rows;
    expect(liabilities.map((r) => r.code)).toEqual(["2000", "2500", "2900"]);
    expect(liabilities[2]).toMatchObject({ external: true, accountId: null, onebookMinor: 0, otherMinor: 75_00, differenceMinor: -75_00, side: "credit" });
    expect(c.groups[4].rows.at(-1)).toMatchObject({ code: "6999", external: true, side: "debit" });
  });
});

describe("the whole-report total is debits less credits", () => {
  const bal = [
    acct("b", "1000", "Cash", "bank"),
    acct("c", "3000", "Capital", "equity"),
    acct("s", "4000", "Sales", "income"),
    acct("r", "6000", "Rent", "expense"),
  ];

  it("is nil for OneBook on a balanced ledger", () => {
    const c = buildComparison({ accounts: bal, figures: { b: 1_000_00, c: 600_00, s: 500_00, r: 100_00 }, typed: {}, externals: [] });
    expect(c.grand.onebookMinor).toBe(0);
    expect(c.grand.otherMinor).toBeNull();
  });

  it("is the gap, with the right sign, when the books do not balance", () => {
    const c = buildComparison({ accounts: bal, figures: { b: 1_000_00, c: 600_00, s: 400_00, r: 100_00 }, typed: {}, externals: [] });
    expect(c.grand.onebookMinor).toBe(100_00);
    const credits = buildComparison({ accounts: bal, figures: { b: 900_00, c: 600_00, s: 500_00, r: 100_00 }, typed: {}, externals: [] });
    expect(credits.grand.onebookMinor).toBe(-100_00);
  });

  it("totals the other system and the difference the same way, on typed rows only", () => {
    const c = buildComparison({
      accounts: bal,
      figures: { b: 1_000_00, c: 600_00, s: 500_00, r: 100_00 },
      typed: { "a:b": 1_000_00, "a:c": 600_00, "a:s": 450_00, "a:r": 100_00 },
      externals: [],
    });
    expect(c.grand.otherMinor).toBe(1_000_00 + 100_00 - (600_00 + 450_00));
    expect(c.grand.differenceMinor).toBe(-50_00);
  });

  it("leaves the group totals in natural sign", () => {
    const c = buildComparison({ accounts: bal, figures: { b: 1_000_00, c: 600_00, s: 500_00, r: 100_00 }, typed: {}, externals: [] });
    expect(c.groups.map((g) => g.totals.onebookMinor)).toEqual([1_000_00, 0, 600_00, 500_00, 100_00]);
  });
});

describe("tableLines", () => {
  const c = buildComparison({
    accounts: ACCOUNTS,
    figures: FIGURES,
    typed: { "a:bank": 900_00, "a:ar": 250_00 },
    externals: [],
  });

  it("draws a heading, the accounts and a total for each group, then the grand total", () => {
    const lines = tableLines(c, false);
    expect(lines[0]).toMatchObject({ kind: "heading", label: "Assets" });
    expect(lines.filter((l) => l.kind === "heading")).toHaveLength(5);
    expect(lines.at(-1)).toMatchObject({ kind: "total", label: "Debits less credits", grand: true });
    expect(lines.filter((l) => l.kind === "total" && !l.grand).map((l) => (l as { label: string }).label)).toEqual([
      "Total assets",
      "Total liabilities",
      "Total equity",
      "Total income",
      "Total expenses",
    ]);
  });

  it("keeps only the rows that differ under Only differences, and drops a group with none", () => {
    const lines = tableLines(c, true);
    const rows = lines.filter((l) => l.kind === "row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: { code: "1010" } });
    expect(lines.filter((l) => l.kind === "heading")).toHaveLength(1);
    // The totals stay whole.
    expect(lines.find((l) => l.kind === "total" && !l.grand)).toMatchObject({ totals: c.groups[0].totals });
    expect(lines.at(-1)).toMatchObject({ grand: true, totals: c.grand });
  });

  it("keeps a row whose box is in error, even though its difference is gone", () => {
    const withError = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed: { "a:bank": 900_00, "a:rent": null }, externals: [] });
    const keys = tableLines(withError, true, new Set(["a:rent"])).filter((l) => l.kind === "row").map((l) => l.key);
    expect(keys).toEqual(["a:bank", "a:rent"]);
    expect(tableLines(withError, true).filter((l) => l.kind === "row").map((l) => l.key)).toEqual(["a:bank"]);
    // Without the filter every row is there anyway.
    expect(tableLines(withError, false, new Set(["a:rent"])).filter((l) => l.kind === "row").length).toBeGreaterThan(2);
  });

  it("is just the grand total when nothing differs", () => {
    const none = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed: {}, externals: [] });
    expect(tableLines(none, true)).toHaveLength(1);
  });
});

describe("the words for an empty filter and a failed load", () => {
  it("says them plainly", () => {
    expect(NO_DIFFERENCES).toBe("No differences to show.");
    expect(LOAD_FAILED).toBe("The comparison could not be loaded. Try again in a moment.");
  });
});

describe("saved lines", () => {
  it("round-trips typed figures and external-only rows", () => {
    const hydrated = hydrateSaved(
      [
        { accountId: "bank", externalCode: null, externalName: null, externalGroup: null, otherMinor: 900_00 },
        { accountId: null, externalCode: "2910", externalName: "Customer Deposits", externalGroup: "income", otherMinor: 75_00 },
      ],
    );
    expect(hydrated.typed).toEqual({ "a:bank": 900_00, "x:2910": 75_00 });
    expect(hydrated.externals).toEqual([{ key: "x:2910", code: "2910", name: "Customer Deposits", group: "income" }]);
    const c = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, ...hydrated });
    expect(draftLines(c)).toEqual([
      { accountId: "bank", otherMinor: 900_00 },
      { externalCode: "2910", externalName: "Customer Deposits", externalGroup: "income", otherMinor: 75_00 },
    ]);
  });

  it("does not save an inactive account again", () => {
    const c = buildComparison({ accounts: ACCOUNTS, figures: FIGURES, typed: { "a:old": 10_00, "a:bank": 1_00 }, externals: [] });
    expect(draftLines(c)).toEqual([{ accountId: "bank", otherMinor: 1_00 }]);
  });

  it("shows a saved external line that has no group in Assets", () => {
    const hydrated = hydrateSaved([{ accountId: null, externalCode: "Z1", externalName: "Loose", externalGroup: null, otherMinor: 5 }]);
    expect(hydrated.externals[0].group).toBe("asset");
  });
});

describe("the heading and the sentences", () => {
  it("states the date and the other system", () => {
    expect(balanceComparisonHeading("2026-09-30", "Sample Ledger")).toBe(
      "Balance Comparison as of Sep 30, 2026 · OneBook and Sample Ledger",
    );
    expect(balanceComparisonHeading("2026-09-30", "  ")).toBe(
      "Balance Comparison as of Sep 30, 2026 · OneBook and the other system",
    );
  });

  it("says how OneBook's column is read", () => {
    expect(BALANCE_BASIS_NOTE).toBe("Balance sheet accounts as at the date; income and expenses for the year to date.");
  });

  it("chooses the nearest saved date, the earlier one on a tie", () => {
    expect(nearestSavedDate("2026-09-30", ["2026-01-31", "2026-08-31", "2026-12-31"])).toBe("2026-08-31");
    expect(nearestSavedDate("2026-09-30", ["2026-09-25", "2026-10-05"])).toBe("2026-09-25");
    expect(nearestSavedDate("2026-09-30", ["2026-09-30"])).toBeNull();
    expect(nearestSavedDate("2026-09-30", [])).toBeNull();
    expect(nearestSavedDate("2026-03-01", ["2025-12-31", "2026-03-31"])).toBe("2026-03-31");
  });

  it("says nothing has been typed, and names the nearest saved comparison", () => {
    const m = nothingTypedMessage("2026-09-30", ["2026-08-31", "2026-02-28"]);
    expect(m.text).toBe("Nothing has been typed for Sep 30, 2026. The nearest saved comparison is Aug 31, 2026.");
    expect(m.nearest).toBe("2026-08-31");
    expect(m.parts).toEqual({
      before: "Nothing has been typed for Sep 30, 2026. The nearest saved comparison is ",
      date: "Aug 31, 2026",
      after: ".",
    });
    expect(`${m.parts!.before}${m.parts!.date}${m.parts!.after}`).toBe(m.text);
  });

  it("says only that nothing has been typed when nothing is saved anywhere", () => {
    expect(nothingTypedMessage("2026-09-30", [])).toEqual({
      text: "Nothing has been typed for Sep 30, 2026.",
      parts: null,
      nearest: null,
    });
  });

  it("says how many figures were saved", () => {
    expect(savedMessage(4, "2026-09-30")).toBe("Saved 4 figures for Sep 30, 2026.");
    expect(savedMessage(1, "2026-09-30")).toBe("Saved 1 figure for Sep 30, 2026.");
    expect(savedMessage(0, "2026-09-30")).toBe("Saved 0 figures for Sep 30, 2026.");
  });

  it("writes a figure back into its box with thousands commas and a plain minus", () => {
    expect(formatFigureText(123456, 2)).toBe("1,234.56");
    expect(formatFigureText(-123456, 2)).toBe("-1,234.56");
    expect(formatFigureText(0, 2)).toBe("0.00");
    expect(formatFigureText(1234, 0)).toBe("1,234");
  });

  it("recognizes a real date", () => {
    expect(isRealIsoDate("2026-09-30")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("30/09/2026")).toBe(false);
  });
});

describe("saving checks", () => {
  const base = { asOf: "2026-09-30", comparedWith: "Sample Ledger", note: "", lines: [] };

  it("passes a good draft", () => {
    expect(draftProblem({ ...base, lines: [{ accountId: "bank", otherMinor: 1 }] })).toBeNull();
  });

  it("refuses a missing date, a missing or long name, a long note", () => {
    expect(draftProblem({ ...base, asOf: "" })).toBe("Choose the date to compare at");
    expect(draftProblem({ ...base, comparedWith: "  " })).toBe("Enter the name of the other system");
    expect(draftProblem({ ...base, comparedWith: "x".repeat(81) })).toBe("The name of the other system is too long (80 characters at most)");
    expect(draftProblem({ ...base, note: "x".repeat(501) })).toBe("The note is too long (500 characters at most)");
  });

  it("refuses a duplicate external code, ignoring case, before the database does", () => {
    const lines = [
      { externalCode: "A-1", externalName: "One", externalGroup: "asset" as const, otherMinor: 1 },
      { externalCode: "a-1", externalName: "Two", externalGroup: "asset" as const, otherMinor: 2 },
    ];
    expect(draftProblem({ ...base, lines })).toBe("Two accounts the other system has share the code a-1");
  });

  it("refuses an account only the other system has when no valid group is chosen", () => {
    const line = { externalCode: "A-1", externalName: "One", externalGroup: "revenue" as never, otherMinor: 1 };
    expect(draftProblem({ ...base, lines: [line] })).toBe("Choose a group for an account only the other system has");
  });

  it("refuses an account twice and a figure that is not whole cents", () => {
    expect(draftProblem({ ...base, lines: [{ accountId: "a", otherMinor: 1 }, { accountId: "a", otherMinor: 2 }] })).toBe(
      "An account appears twice",
    );
    expect(draftProblem({ ...base, lines: [{ accountId: "a", otherMinor: 1.5 }] })).toBe("A figure must be a whole number of cents");
  });

  describe("adding an account the other system has", () => {
    const none = new Set<string>();
    it("builds the row and reads the figure on the chosen group's side", () => {
      const r = checkNewExternal({ code: " 2910 ", name: " Customer Deposits ", group: "liability", figure: "75.00 DR" }, none, 2);
      expect(r).toEqual({ ok: true, row: { key: "x:2910", code: "2910", name: "Customer Deposits", group: "liability" }, minor: -7500 });
    });

    it("asks for each part and refuses a code already in the list, ignoring case", () => {
      expect(checkNewExternal({ code: "", name: "N", group: "asset", figure: "1" }, none, 2)).toMatchObject({ field: "code" });
      expect(checkNewExternal({ code: "C", name: "", group: "asset", figure: "1" }, none, 2)).toMatchObject({ field: "name" });
      expect(checkNewExternal({ code: "C", name: "N", group: "asset", figure: "" }, none, 2)).toMatchObject({
        field: "figure",
        error: "Enter the figure the other system shows",
      });
      expect(checkNewExternal({ code: "C", name: "N", group: "asset", figure: "abc" }, none, 2)).toEqual({
        ok: false,
        field: "figure",
        error: "Not a number: abc",
      });
      expect(checkNewExternal({ code: "Zed", name: "N", group: "asset", figure: "1" }, new Set(["x:zed"]), 2)).toEqual({
        ok: false,
        field: "code",
        error: "The code Zed is already in the list",
      });
    });
  });
});

describe("balanceComparisonSheet", () => {
  const c = buildComparison({
    accounts: ACCOUNTS,
    figures: FIGURES,
    typed: { "a:bank": 900_00, "a:old": 10_00 },
    externals: [],
  });
  const meta = {
    asOf: "2026-09-30",
    comparedWith: "Sample Ledger",
    companyName: "Test Company",
    currencyCode: "USD",
    decimals: 2,
    onlyDifferences: false,
  };

  it("carries the heading in the subtitle and names the other system's column", () => {
    const sheet = balanceComparisonSheet(c, meta);
    expect(sheet.title).toBe("Balance Comparison");
    expect(sheet.subtitle).toBe(
      `Balance Comparison as of Sep 30, 2026 · OneBook and Sample Ledger. ${BALANCE_BASIS_NOTE}`,
    );
    expect(sheet.columns.map((col) => col.header)).toEqual(["Code", "Account", "OneBook", "Sample Ledger", "Difference"]);
    expect(sheet.fileName).toBe("balance-comparison-2026-09-30");
  });

  it("exports the rows in major units, with blanks where there is no figure", () => {
    const rows = balanceComparisonSheet(c, meta).rows;
    expect(rows[0]).toMatchObject({ account: "Assets", onebook: null });
    expect(rows[1]).toEqual({ code: "1010", account: "Harbor Checking", onebook: 1000, other: 900, difference: 100 });
    expect(rows[2]).toMatchObject({ code: "1200", other: null, difference: null });
    const old = rows.find((r) => r.code === "6950");
    expect(old).toMatchObject({ account: "Retired Fees (inactive)", other: 10, difference: 5 });
    expect(rows.at(-1)).toMatchObject({ account: "Debits less credits" });
  });

  it("exports only the rows that differ when asked", () => {
    const rows = balanceComparisonSheet(c, { ...meta, onlyDifferences: true }).rows;
    expect(rows.filter((r) => r.code !== null).map((r) => r.code)).toEqual(["1010", "6950"]);
  });

  it("names the column for the other system when it has no name yet", () => {
    expect(balanceComparisonSheet(c, { ...meta, comparedWith: "" }).columns[3].header).toBe("The other system");
  });
});
