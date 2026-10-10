import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/lib/domain/accounts";
import {
  ACCOUNT_SECTIONS,
  accountGroups,
  accountSections,
  compareCodes,
  parentChoices,
  sectionOf,
  withAncestors,
  type SectionAccount,
} from "@/lib/domain/account-sections";

const acc = (id: string, code: string, type: AccountType, parent: string | null = null, detail: string | null = null): SectionAccount => ({
  id,
  account_code: code,
  account_type: type,
  detail_type: detail,
  parent_account_id: parent,
});

describe("the sections of a chart", () => {
  it("are the client's, in order, with other expenses last", () => {
    expect(ACCOUNT_SECTIONS.map((s) => s.title)).toEqual([
      "Current Assets – Bank Accounts",
      "Current Assets – Receivables & Inventory",
      "Non-current Assets",
      "Current Liabilities",
      "Non-current Liabilities",
      "Equity",
      "Income",
      "Cost of Goods Sold",
      "Operating Expenses",
      "Other Expenses",
    ]);
  });

  it("place every type, and money in transit with the banks", () => {
    expect(sectionOf({ account_type: "bank", detail_type: null })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: "undeposited_funds" })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: "transfer_clearing" })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: null })).toBe("receivables_inventory");
    expect(sectionOf({ account_type: "accounts_receivable", detail_type: null })).toBe("receivables_inventory");
    expect(sectionOf({ account_type: "fixed_asset", detail_type: null })).toBe("non_current_assets");
    expect(sectionOf({ account_type: "credit_card", detail_type: null })).toBe("current_liabilities");
    expect(sectionOf({ account_type: "long_term_liability", detail_type: null })).toBe("non_current_liabilities");
    expect(sectionOf({ account_type: "other_income", detail_type: null })).toBe("income");
    expect(sectionOf({ account_type: "other_expense", detail_type: null })).toBe("other_expenses");
  });

  it("orders codes as numbers", () => {
    expect(["1000", "400", "90", "4010"].sort(compareCodes)).toEqual(["90", "400", "1000", "4010"]);
  });

  it("nests sub-accounts under their parent, in code order, and leaves empty sections out", () => {
    const sections = accountSections([
      acc("inv", "1200", "current_asset"),
      acc("jewel", "1230", "current_asset", "inv"),
      acc("und", "1210", "current_asset", null, "undeposited_funds"),
      acc("raw", "1250", "current_asset", "inv"),
      acc("cash", "1000", "bank"),
      acc("ar", "1100", "accounts_receivable"),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["bank", "receivables_inventory"]);
    expect(sections[0].rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["1000", 0],
      ["1210", 0],
    ]);
    expect(sections[1].rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["1100", 0],
      ["1200", 0],
      ["1230", 1],
      ["1250", 1],
    ]);
  });

  it("puts a sub-account at the top of its own section when its parent is elsewhere or missing", () => {
    const sections = accountSections([
      acc("sales", "4000", "income"),
      acc("odd", "6010", "expense", "sales"),
      acc("orphan", "6020", "expense", "gone"),
    ]);
    const opex = sections.find((s) => s.key === "operating_expenses")!;
    expect(opex.rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["6010", 0],
      ["6020", 0],
    ]);
  });

  it("survives a loop in the chart", () => {
    const sections = accountSections([acc("a", "6100", "expense", "b"), acc("b", "6200", "expense", "a")]);
    expect(sections[0].rows.map((r) => r.account.account_code).sort()).toEqual(["6100", "6200"]);
  });
});

describe("a search result in its place", () => {
  const chart = [
    acc("opex", "6000", "expense"),
    acc("rent", "6030", "expense", "opex"),
    acc("store", "6031", "expense", "rent"),
    acc("bank", "6080", "expense", "opex"),
  ];

  it("keeps each match under its parent and grandparent, and nothing else", () => {
    const store = chart.find((a) => a.id === "store")!;
    expect(withAncestors(chart, [store]).map((a) => a.id)).toEqual(["opex", "rent", "store"]);
    const rows = accountSections(withAncestors(chart, [store]))[0].rows;
    expect(rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["6000", 0],
      ["6030", 1],
      ["6031", 2],
    ]);
  });

  it("survives a loop and a missing parent", () => {
    const loop = [acc("a", "6100", "expense", "b"), acc("b", "6200", "expense", "a"), acc("c", "6300", "expense", "gone")];
    expect(withAncestors(loop, [loop[0]]).map((a) => a.id)).toEqual(["a", "b"]);
    expect(withAncestors(loop, [loop[2]]).map((a) => a.id)).toEqual(["c"]);
  });
});

describe("the parents an account may have", () => {
  const chart = [
    acc("inv", "1200", "current_asset"),
    acc("jewel", "1230", "current_asset", "inv"),
    acc("ap", "2000", "accounts_payable"),
  ];

  it("are accounts of its own type, never itself", () => {
    expect(parentChoices(chart, "current_asset", "jewel").map((a) => a.id)).toEqual(["inv"]);
    expect(parentChoices(chart, "current_asset", null).map((a) => a.id)).toEqual(["inv", "jewel"]);
    expect(parentChoices(chart, "accounts_payable", null).map((a) => a.id)).toEqual(["ap"]);
  });

  it("are every other account until a type is chosen", () => {
    expect(parentChoices(chart, undefined, "ap").map((a) => a.id)).toEqual(["inv", "jewel"]);
  });
});

describe("accountGroups", () => {
  const groups = [
    { key: "big", title: "Big" },
    { key: "small", title: "Small" },
    { key: "none", title: "Empty" },
  ] as const;
  const byCode = (a: SectionAccount) => (Number(a.account_code) >= 2000 ? "small" : "big");

  it("groups by any function, in the order given, dropping empty groups", () => {
    const out = accountGroups(
      [acc("b", "2100", "expense"), acc("a", "1000", "bank"), acc("c", "1500", "bank")],
      groups,
      (a) => byCode(a) as "big" | "small" | "none",
    );
    expect(out.map((g) => g.key)).toEqual(["big", "small"]);
    expect(out[0].rows.map((r) => r.account.id)).toEqual(["a", "c"]);
    expect(out[1].rows.map((r) => r.account.id)).toEqual(["b"]);
  });

  it("nests a sub-account only under a parent in the same group", () => {
    const out = accountGroups(
      [
        acc("p", "1000", "bank"),
        acc("same", "1010", "bank", "p"),
        acc("other", "2010", "bank", "p"),
      ],
      groups,
      (a) => byCode(a) as "big" | "small" | "none",
    );
    expect(out[0].rows.map((r) => [r.account.id, r.depth])).toEqual([
      ["p", 0],
      ["same", 1],
    ]);
    expect(out[1].rows.map((r) => [r.account.id, r.depth])).toEqual([["other", 0]]);
  });
});

describe("account-sections module", () => {
  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/account-sections.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
