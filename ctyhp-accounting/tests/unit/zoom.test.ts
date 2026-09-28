import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZoomSpec } from "@/lib/domain/statement";
import { buildZoom, zoomSign, zoomSpecProblem, type ZoomAccount, type ZoomLineInput } from "@/lib/domain/zoom";

const ACCOUNTS = new Map<string, ZoomAccount>([
  ["sales", { id: "sales", code: "4000", name: "Sales", type: "income" }],
  ["rent", { id: "rent", code: "6100", name: "Rent", type: "expense" }],
  ["bank", { id: "bank", code: "1000", name: "Operating Bank", type: "bank" }],
  ["fees", { id: "fees", code: "6500", name: "Bank Fees", type: "expense" }],
]);
const LABELS = new Map([...ACCOUNTS.values()].map((a) => [a.id, `${a.code} ${a.name}`]));

const line = (over: Partial<ZoomLineInput>): ZoomLineInput => ({
  lineId: "l1",
  entryId: "e1",
  entryNumber: "JE-000001",
  entryDate: "2026-04-10",
  sourceType: "manual",
  accountId: "sales",
  debitBase: 0,
  creditBase: 0,
  name: "Harbour Property Ltd",
  ...over,
});

const spec = (over: Partial<ZoomSpec>): ZoomSpec => ({
  title: "Total Income",
  accountIds: ["sales"],
  from: "2026-04-01",
  to: "2026-06-30",
  figure: 0,
  ...over,
});

describe("zoomSign", () => {
  it("follows the figure when there is one to follow, and the accounts' side when there is not", () => {
    expect(zoomSign(1_200, -1_200, true)).toBe(-1);
    expect(zoomSign(-50, -50, false)).toBe(1);
    expect(zoomSign(0, 0, true)).toBe(-1);
    expect(zoomSign(0, 0, false)).toBe(1);
  });
});

describe("buildZoom", () => {
  const args = { accounts: ACCOUNTS, labels: LABELS, entryAccounts: new Map<string, string[]>(), openingRaw: null };

  it("adds up to the figure that opened it, for an income account shown as positive", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ figure: 1_200, accountIds: ["sales", "rent"] }),
      lines: [
        line({ lineId: "a", creditBase: 1_000 }),
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", creditBase: 300 }),
        line({ lineId: "c", entryId: "e3", entryNumber: "JE-000003", debitBase: 100 }),
      ],
    });
    expect(z.rows.map((r) => r.amount)).toEqual([1_000, 300, -100]);
    expect(z.total).toBe(1_200);
    expect(z.matches).toBe(true);
    expect(z.rows[0].detail).toBe("4000 Sales");
    expect(z.single).toBe(false);
  });

  it("runs a balance from the account's balance on the day before, for one account", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ title: "6100 Rent", accountIds: ["rent"], figure: 300 }),
      openingRaw: 5_000,
      lines: [
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", entryDate: "2026-05-01", accountId: "rent", debitBase: 100 }),
        line({ lineId: "a", entryId: "e1", entryDate: "2026-04-01", accountId: "rent", debitBase: 200 }),
      ],
    });
    expect(z.opening).toBe(5_000);
    expect(z.rows.map((r) => [r.entryDate, r.amount, r.balance])).toEqual([
      ["2026-04-01", 200, 5_200],
      ["2026-05-01", 100, 5_300],
    ]);
    expect(z.matches).toBe(true);
  });

  it("names the other side of one account's entry, or calls it a split", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ title: "1000 Operating Bank", accountIds: ["bank"], from: null, figure: -80 }),
      entryAccounts: new Map([
        ["e1", ["bank", "rent"]],
        ["e2", ["bank", "rent", "fees"]],
      ]),
      lines: [
        line({ lineId: "a", entryId: "e1", accountId: "bank", creditBase: 50 }),
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", accountId: "bank", creditBase: 30 }),
      ],
    });
    expect(z.rows.map((r) => r.detail)).toEqual(["6100 Rent", "— Split —"]);
    expect(z.opening).toBeNull();
    expect(z.total).toBe(-80);
  });

  it("says so when the lines do not add up to the figure", () => {
    const z = buildZoom({ ...args, spec: spec({ figure: 999 }), lines: [line({ creditBase: 1_000 })] });
    expect(z.matches).toBe(false);
  });
});

describe("zoomSpecProblem", () => {
  const ok = {
    title: "Total Income",
    accountIds: ["3f2b8c1e-7a4d-4c2b-9e1f-0a1b2c3d4e5f"],
    from: "2026-04-01",
    to: "2026-06-30",
    figure: 1200,
  };

  it("accepts a figure from a statement", () => {
    expect(zoomSpecProblem(ok)).toBeNull();
    expect(zoomSpecProblem({ ...ok, from: null })).toBeNull();
  });

  it("refuses anything that is not one", () => {
    expect(zoomSpecProblem(null)).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: [] })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: ["JE-000001"] })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, to: "June 30" })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, from: "2026-07-01" })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, figure: 1.5 })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: new Array(2001).fill(ok.accountIds[0]) })).not.toBeNull();
  });

  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/zoom.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
