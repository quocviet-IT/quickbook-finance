import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyAccounts,
  planAccountClassification,
} from "@/lib/services/account-classification";
import { detailTypeFromName } from "@/lib/domain/bank-account-detail";
import { defaultCashFlowRole } from "@/lib/domain/cashflow";

/** The shape the chart of Pacific Four Nine actually arrived in. */
const IMPORTED = [
  ["600", "Bank Service Charges", "expense", "unclassified", null],
  ["654", "Payroll - Salary & Wages", "expense", "unclassified", null],
  ["400", "Sales", "income", "unclassified", null],
  ["500", "Cost of Goods Sold", "cost_of_goods_sold", "unclassified", null],
  ["220", "Shareholder Loan", "equity", "unclassified", null],
  ["170", "Inventory Purchase", "current_asset", "unclassified", null],
  ["151", "Transfer Clearing", "current_asset", "unclassified", null],
  ["121", "PC49 BoA CK 3388", "bank", "cash", "checking"],
  ["133", "Northern Savings", "bank", "unclassified", null],
  ["610", "Fund Transfer", "expense", "investing", null],
];

function chartClient(rows = IMPORTED) {
  const updates: { patch: Record<string, unknown>; ids: string[] }[] = [];
  const accounts = rows.map(([account_code, name, account_type, cash_flow_role, detail_type], i) => ({
    id: `account-${i}`,
    account_code,
    name,
    account_type,
    cash_flow_role,
    detail_type,
  }));

  const from = () => {
    let patch: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (values: Record<string, unknown>) => {
        patch = values;
        return chain;
      },
      in: (_column: string, ids: string[]) => {
        updates.push({ patch, ids });
        return chain;
      },
      eq: () => chain,
      is: () => chain,
      neq: () => chain,
      order: () => chain,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: accounts, error: null }).then(resolve),
    };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, updates };
}

describe("planAccountClassification", () => {
  it("offers the accounts whose type already has an answer", async () => {
    const { client } = chartClient();

    const plan = await planAccountClassification(client);

    expect(plan.roles.map((a) => a.account_code).sort()).toEqual([
      "133",
      "220",
      "400",
      "500",
      "600",
      "654",
    ]);
  });

  it("leaves a generic current asset for an accountant", async () => {
    // Whether a loan or a clearing account is operating, investing or financing
    // is a policy. Defaulting it would classify money nobody looked at.
    const { client } = chartClient();

    const plan = await planAccountClassification(client);

    expect(plan.unanswerable.map((a) => a.account_code).sort()).toEqual(["151", "170"]);
    expect(plan.roles.map((a) => a.account_code)).not.toContain("170");
  });

  it("never touches an account somebody has already classified", async () => {
    const { client } = chartClient();

    const plan = await planAccountClassification(client);

    // 610 was deliberately set to investing; 121 already reads cash.
    for (const code of ["610", "121"]) {
      expect(plan.roles.map((a) => a.account_code)).not.toContain(code);
      expect(plan.unanswerable.map((a) => a.account_code)).not.toContain(code);
    }
  });

  it("offers a bank account the kind its name plainly states", async () => {
    const { client } = chartClient();

    const plan = await planAccountClassification(client);

    expect(plan.details.map((a) => a.account_code)).toEqual(["133"]);
  });

  it("offers nothing when a bank account's name settles nothing", async () => {
    const { client } = chartClient([["131", "PC49 Relay 3224", "bank", "cash", null]]);

    const plan = await planAccountClassification(client);

    expect(plan.details).toEqual([]);
  });
});

describe("classifyAccounts", () => {
  it("writes one update per answer, not one per account", async () => {
    const { client, updates } = chartClient();

    const outcome = await classifyAccounts(client);

    expect(outcome.rolesSet).toBe(6);
    expect(outcome.detailsSet).toBe(1);
    // operating (600, 654, 400, 500), financing (220), cash (133), savings.
    expect(updates.length).toBeLessThanOrEqual(4);
    const operating = updates.find((u) => u.patch.cash_flow_role === "operating");
    expect(operating?.ids).toHaveLength(4);
  });

  it("names what still needs a person rather than counting it", async () => {
    const { client } = chartClient();

    const outcome = await classifyAccounts(client);

    expect(outcome.stillUnclassified.map((a) => a.account_code).sort()).toEqual(["151", "170"]);
    expect(outcome.stillUnclassified[0].name.length).toBeGreaterThan(0);
  });
});

describe("detailTypeFromName", () => {
  it("reads the four things a name can settle", () => {
    expect(detailTypeFromName("Petty Cash")).toBe("cash_on_hand");
    expect(detailTypeFromName("1000 Cash on Hand")).toBe("cash_on_hand");
    expect(detailTypeFromName("Operating Bank Account")).toBe("checking");
    expect(detailTypeFromName("PC49 BoA Checking 3388")).toBe("checking");
    expect(detailTypeFromName("Northern Savings")).toBe("savings");
    expect(detailTypeFromName("Treasury Money Market")).toBe("money_market");
  });

  it("says nothing when the name says nothing", () => {
    // 0072 stopped at four readings on purpose: guessing a classification onto
    // a ledger account is how a balance sheet ends up quietly wrong.
    expect(detailTypeFromName("PC49 Relay CK 3224")).toBeNull();
    expect(detailTypeFromName("")).toBeNull();
    expect(detailTypeFromName(null)).toBeNull();
  });

  it("puts cash on hand ahead of the others, as the migration does", () => {
    // "Petty Cash Checking" must not become a checking account: the database
    // refuses a bank record on cash on hand, and that refusal is the point.
    expect(detailTypeFromName("Petty Cash Checking")).toBe("cash_on_hand");
  });
});

describe("the classification is the one the rest of the app uses", () => {
  it("matches defaultCashFlowRole exactly", () => {
    // Two implementations of this rule is how the account resolver went wrong.
    expect(defaultCashFlowRole("expense")).toBe("operating");
    expect(defaultCashFlowRole("equity")).toBe("financing");
    expect(defaultCashFlowRole("bank")).toBe("cash");
    expect(defaultCashFlowRole("current_asset")).toBe("unclassified");
    expect(defaultCashFlowRole("current_liability")).toBe("unclassified");
  });
});
