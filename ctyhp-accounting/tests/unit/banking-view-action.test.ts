import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The banking screen drew its lines from six Server Actions, four of them in a
 * Promise.all. Next dispatches Server Actions one at a time per client (Server
 * Actions and Mutations, "Sequential dispatch"), so those six ran one after
 * another — the two hint reads queued first — and the table said "No bank
 * transactions" for four to six seconds before the first line appeared
 * (production, 08/10). The reads now travel as two actions that do their
 * work side by side on the server, and the table shows it is loading.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  listBankTransactions: vi.fn(),
  listSuggestions: vi.fn(),
  listBankTransactionPostings: vi.fn(),
  listBankRecodes: vi.fn(),
  codingSuggestions: vi.fn(),
  loanSuggestions: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ getUserRole: vi.fn(), canWrite: vi.fn(), getSessionUser: vi.fn() }));
vi.mock("@/lib/services/banking", () => ({
  listBankTransactions: mocks.listBankTransactions,
  listSuggestions: mocks.listSuggestions,
  listBankTransactionPostings: mocks.listBankTransactionPostings,
  listBankRecodes: mocks.listBankRecodes,
  BankingError: class BankingError extends Error {},
}));
vi.mock("@/lib/services/coding", () => ({ codingSuggestions: mocks.codingSuggestions, codeFromSuggestions: vi.fn() }));
vi.mock("@/lib/services/loan-payments", () => ({ loanSuggestions: mocks.loanSuggestions, postLoanPayment: vi.fn() }));
vi.mock("@/lib/services/plaid", () => ({ createPlaidLinkToken: vi.fn() }));
vi.mock("@/lib/services/statement-files", () => ({ tieKeptStatementFile: vi.fn() }));
vi.mock("@/lib/services/bank-feeds", () => ({
  disconnectBankConnection: vi.fn(),
  listBankFeedSyncs: vi.fn(),
  undoBankFeedSync: vi.fn(),
}));

import { getBankingHintsAction, getBankingViewAction } from "@/app/(app)/banking/actions";

const sb = { name: "company client" };

describe("getBankingViewAction reads the lines and what they are drawn with, in one request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(sb);
    mocks.listBankTransactions.mockResolvedValue([{ id: "t1" }]);
    mocks.listSuggestions.mockResolvedValue([{ id: "s1" }]);
    mocks.listBankTransactionPostings.mockResolvedValue([{ id: "p1" }]);
    mocks.listBankRecodes.mockResolvedValue([{ id: "r1" }]);
  });

  it("asks for one client and runs all four reads with it, for the account asked", async () => {
    const view = await getBankingViewAction("acct-1");
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    for (const read of [mocks.listBankTransactions, mocks.listSuggestions, mocks.listBankTransactionPostings, mocks.listBankRecodes]) {
      expect(read).toHaveBeenCalledWith(sb, "acct-1");
    }
    expect(view).toEqual({
      transactions: { ok: true, data: [{ id: "t1" }] },
      suggestions: { ok: true, data: [{ id: "s1" }] },
      postings: { ok: true, data: [{ id: "p1" }] },
      recodes: { ok: true, data: [{ id: "r1" }] },
    });
  });

  it("passes null through, which is how the review queue spans every account", async () => {
    await getBankingViewAction(null);
    expect(mocks.listBankTransactions).toHaveBeenCalledWith(sb, null);
  });

  it("keeps each read's failure to itself, as the four separate actions did", async () => {
    mocks.listBankRecodes.mockRejectedValue(new Error("recodes unavailable"));
    const view = await getBankingViewAction("acct-1");
    expect(view.recodes).toEqual({ ok: false, error: "recodes unavailable" });
    expect(view.transactions).toEqual({ ok: true, data: [{ id: "t1" }] });
  });

  it("reports every part failed, and runs no read, when there are no books to read", async () => {
    mocks.createClient.mockRejectedValue(new Error("This account does not belong to any company."));
    const view = await getBankingViewAction("acct-1");
    for (const part of [view.transactions, view.suggestions, view.postings, view.recodes]) {
      expect(part).toEqual({ ok: false, error: "This account does not belong to any company." });
    }
    expect(mocks.listBankTransactions).not.toHaveBeenCalled();
  });
});

describe("getBankingHintsAction reads both kinds of suggestion together", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(sb);
    mocks.codingSuggestions.mockResolvedValue([{ transactionId: "t1" }]);
    mocks.loanSuggestions.mockResolvedValue([{ transactionId: "t2" }]);
  });

  it("returns coding and loan suggestions from one client, each with its own outcome", async () => {
    mocks.loanSuggestions.mockRejectedValue(new Error("no repayments"));
    const hints = await getBankingHintsAction(null);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(hints.coding).toEqual({ ok: true, data: [{ transactionId: "t1" }] });
    expect(hints.loans).toEqual({ ok: false, error: "no repayments" });
  });
});

describe("the banking screen asks for its lines first and says it is loading", () => {
  const client = readFileSync(join(process.cwd(), "app/(app)/banking/BankingClient.tsx"), "utf8");

  it("dispatches the view before the hints, so the lines are first in Next's queue", () => {
    const view = client.indexOf("getBankingViewAction(accountFilter)");
    const hints = client.indexOf("getBankingHintsAction(accountFilter)");
    expect(view).toBeGreaterThan(-1);
    expect(hints).toBeGreaterThan(view);
  });

  it("starts the lines from a layout effect, ahead of the registers below the table", () => {
    // BankImportList and BankFeedSyncList read their own data in useEffect.
    // React runs a child's effects before its parent's, so a useEffect here put
    // both registers ahead of the lines in Next's queue (8 actions measured,
    // the lines sixth). Every layout effect runs before any passive one.
    expect(client).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]{0,400}?reload\(\);/);
    expect(client).not.toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}?reload\(\);\s*\}, \[reload\]\)/);
  });

  it("no longer sends the six reads as separate actions", () => {
    for (const old of [
      "getTransactionsAction",
      "getSuggestionsAction",
      "getBankPostingsAction",
      "getBankRecodesAction",
      "getCodingSuggestionsAction",
      "getLoanSuggestionsAction",
    ]) {
      expect(client, old).not.toContain(old);
    }
  });

  it("starts in the loading state when there is an account to load, not as an empty table", () => {
    expect(client).not.toMatch(/const \[loading, setLoading\] = useState\(false\)/);
    expect(client).toMatch(/const \[loading, setLoading\] = useState\(selectedId !== undefined\)/);
  });
});
