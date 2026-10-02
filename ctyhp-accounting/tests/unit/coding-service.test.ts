import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import type { RepaymentAccount } from "@/lib/domain/repayments";
import { codeFromSuggestions, loadHistory, suggestionsFrom, type CodingInputs } from "@/lib/services/coding";

const sb = {} as SupabaseClient;
const acct = (id: string, name: string, over: Partial<AccountRow> = {}) =>
  ({ id, account_code: id.toUpperCase(), name, account_type: "expense", status: "active", is_posting_account: true, ...over }) as AccountRow;
const txn = (id: string, description: string, amount_minor: number, over: Partial<BankTransactionRow> = {}) =>
  ({ id, description, amount_minor, status: "unmatched", pending: false, merchant_name: null, ...over }) as BankTransactionRow;

const inputs = (over: Partial<CodingInputs> = {}): CodingInputs => ({
  lines: [txn("t1", "Metro Realty Partners", -420000)],
  rules: [],
  history: [
    { entryId: "e1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "e2", date: "2026-02-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
  ],
  accounts: [acct("rent", "Rent"), acct("fees", "Bank Fees")],
  matchedLineIds: new Set(),
  repayments: [],
  baseCurrencyBankIds: new Set(),
  ...over,
});

describe("suggestionsFrom", () => {
  it("gives a waiting line its history suggestion, in the screen's words", () => {
    expect(suggestionsFrom(inputs())).toEqual([
      {
        transactionId: "t1",
        accountId: "rent",
        accountLabel: "RENT — Rent",
        source: "history",
        short: "2 of 2",
        why: 'Coded to RENT Rent 2 of the last 2 times for "metro realty partners"',
      },
    ]);
  });
  it("leaves out lines already matched, lines with a match suggestion, and pending feed lines", () => {
    expect(suggestionsFrom(inputs({ lines: [txn("t1", "Metro Realty Partners", -420000, { status: "matched" })] }))).toEqual([]);
    expect(suggestionsFrom(inputs({ matchedLineIds: new Set(["t1"]) }))).toEqual([]);
    expect(suggestionsFrom(inputs({ lines: [txn("t1", "Metro Realty Partners", -420000, { pending: true })] }))).toEqual([]);
  });
  it("does not learn from an account that may not teach", () => {
    expect(suggestionsFrom(inputs({ accounts: [acct("rent", "Rent", { status: "inactive" })] }))).toEqual([]);
  });
  it("puts a rule ahead of history", () => {
    const rules = [
      { id: "r", position: 1, matchKind: "words" as const, matchText: "metro", direction: "any" as const, minMinor: null, maxMinor: null, accountId: "fees", isActive: true },
    ];
    expect(suggestionsFrom(inputs({ rules }))[0]).toMatchObject({ accountId: "fees", source: "rule", short: "Rule 1" });
  });
});

describe("loadHistory", () => {
  it("pages the history read and keeps only the texts that say something", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ entry_id: "e1", entry_date: "2026-01-05", direction: "out", account_id: "rent", entry_description: "Metro — rent", other_memo: "  ", bank_description: null }],
      error: null,
    });
    const order = vi.fn(() => ({ range }));
    const client = { rpc: vi.fn(() => ({ order })) } as unknown as SupabaseClient;
    expect(await loadHistory(client)).toEqual([
      { entryId: "e1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro — rent"] },
    ]);
    expect(order).toHaveBeenCalledWith("entry_id");
    expect(range).toHaveBeenCalledWith(0, 999);
  });
  it("asks only for the accounts named, and nothing at all for none", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ range }));
    const inFn = vi.fn(() => ({ order }));
    const rpc = vi.fn(() => ({ in: inFn }));
    await loadHistory({ rpc } as unknown as SupabaseClient, ["acct-1"]);
    expect(rpc).toHaveBeenCalledWith("acc_coding_history");
    expect(inFn).toHaveBeenCalledWith("account_id", ["acct-1"]);
    const none = vi.fn();
    expect(await loadHistory({ rpc: none } as unknown as SupabaseClient, [])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });
});

describe("suggestionsFrom with the register", () => {
  const card = {
    id: "rp1",
    kind: "card" as const,
    accountId: "card1",
    matchWords: "metro",
    matchDigits: null,
    interestAccountId: null,
    interestMethod: null,
    annualRate: null,
    fixedInterestMinor: null,
    isActive: true,
  };
  const company = { id: "rc1", name: "Example Affiliate", accountId: "due", matchWords: "example affiliate", isActive: true };
  const chart = [
    acct("rent", "Rent"),
    acct("card1", "Example Card", { account_type: "credit_card" }),
    acct("due", "Due from/to Example Affiliate", { account_type: "current_asset" }),
  ];
  const line = txn("t1", "Metro Realty Partners", -420000, { bank_account_id: "bank1" });
  const base = new Set(["bank1"]);
  it("proposes the card ahead of history, on a bank in the base currency", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: base }));
    expect(views[0]).toMatchObject({ accountId: "card1", source: "card", short: "Card" });
  });
  it("leaves a line on a foreign-currency bank to history", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: new Set() }));
    expect(views[0]).toMatchObject({ accountId: "rent", source: "history" });
  });
  it("gives no suggestion when two entries claim the line", () => {
    const other = { ...card, id: "rp2", accountId: "card2" };
    const twoCards = [...chart, acct("card2", "Other Card", { account_type: "credit_card" })];
    expect(suggestionsFrom(inputs({ lines: [line], accounts: twoCards, repayments: [card, other], baseCurrencyBankIds: base }))).toEqual([]);
  });
  it("proposes a related company named on money in, ahead of history", () => {
    const wire = txn("t2", "WIRE FROM EXAMPLE AFFILIATE", 1500000, { bank_account_id: "bank1" });
    const views = suggestionsFrom(inputs({ lines: [wire], accounts: chart, related: [company], baseCurrencyBankIds: base }));
    expect(views).toEqual([
      expect.objectContaining({ transactionId: "t2", accountId: "due", source: "related", short: "Related" }),
    ]);
  });
  it("gives no suggestion when a related company and a card both claim the line", () => {
    const both = txn("t3", "METRO CARD PAID FOR EXAMPLE AFFILIATE", -50000, { bank_account_id: "bank1" });
    expect(
      suggestionsFrom(inputs({ lines: [both], accounts: chart, repayments: [card], related: [company], baseCurrencyBankIds: base })),
    ).toEqual([]);
  });
});

describe("codeFromSuggestions", () => {
  const view = (transactionId: string, accountId: string): CodingSuggestionView => ({
    transactionId,
    accountId,
    accountLabel: accountId,
    source: "history",
    short: "2 of 2",
    why: "",
  });

  it("works the suggestions out again and posts each line whose suggestion still stands", async () => {
    const categorise = vi.fn(async (...args: [SupabaseClient, string, string]) => ({ entry_number: `JE-${args[1]}` }));
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t1", "rent"), view("t2", "rent")], categorise },
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: true, entry_number: "JE-t1" },
      { id: "t2", ok: true, entry_number: "JE-t2" },
    ]);
    expect(categorise.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["t1", "rent"],
      ["t2", "rent"],
    ]);
  });

  it("posts nothing for a line whose suggestion is gone or changed, and says why", async () => {
    const categorise = vi.fn();
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t2", "fees")], categorise },
    );
    expect(categorise).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ id: "t1", ok: false, error: expect.stringMatching(/no suggestion/) });
    expect(outcomes[1]).toMatchObject({ id: "t2", ok: false, error: expect.stringMatching(/changed/) });
  });

  it("reports a refusal word for word and carries on with the rest", async () => {
    const categorise = vi
      .fn()
      .mockRejectedValueOnce(new Error("The period is closed"))
      .mockResolvedValueOnce({ entry_number: "JE-2" });
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t1", "rent"), view("t2", "rent")], categorise },
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: false, error: "The period is closed" },
      { id: "t2", ok: true, entry_number: "JE-2" },
    ]);
  });

  it("refuses more than a hundred lines at once", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ transactionId: `t${i}`, accountId: "rent" }));
    await expect(codeFromSuggestions(sb, items, { suggestions: async () => [], categorise: vi.fn() })).rejects.toThrow(/100/);
  });
});
