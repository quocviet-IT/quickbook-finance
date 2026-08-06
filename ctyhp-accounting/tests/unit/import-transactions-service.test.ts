import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { previewImport, runImport } from "@/lib/services/data-import";

const MAPPING = {
  txn_date: 0,
  description: 1,
  bank_account: 2,
  category_account: 3,
  amount: 4,
  debit: null,
  credit: null,
};
/** Data rows only: the screen keeps the header in its own state, and
 *  `applyMapping` is given what is left. */
const ROWS = [
  ["2026-01-15", "Zelle Transfer", "121 - PC49 BoA CK 3388", "Inventory Purchase", "-3200.00"],
  ["2026-01-16", "Deposit", "121 - PC49 BoA CK 3388", "Sales", "969.00"],
];

/** A chart with both accounts, a bank record for the bank, and no history. */
function companyClient(
  overrides: { accounts?: string[][]; hashes?: string[]; bankedIds?: string[] } = {},
) {
  const accounts = overrides.accounts ?? [
    ["121", "PC49 BoA CK 3388"],
    ["", "Inventory Purchase"],
    ["", "Sales"],
  ];
  const rpc = vi.fn().mockResolvedValue({ data: { imported: 2, skipped: 0 }, error: null });
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === "acc_account"
            ? {
                data: accounts.map(([account_code, name], index) => ({
                  id: `account-${index}`,
                  account_code,
                  name,
                })),
                error: null,
              }
            : table === "acc_bank_account"
              ? {
                  data: (overrides.bankedIds ?? ["account-0"]).map((account_id) => ({
                    account_id,
                  })),
                  error: null,
                }
              : {
                  data: (overrides.hashes ?? []).map((raw_hash) => ({ raw_hash })),
                  error: null,
                },
        ).then(resolve),
    };
    return chain;
  };
  return { rpc, from } as unknown as SupabaseClient & { rpc: typeof rpc };
}

describe("previewImport for transactions", () => {
  it("counts the rows it can post and names the ones it cannot", async () => {
    const sb = companyClient();

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.creates).toBe(2);
    expect(preview.missingAccounts ?? []).toEqual([]);
    expect(preview.rows[0].name).toContain("Inventory Purchase");
  });

  it("blocks the file by naming every account the chart does not have", async () => {
    const sb = companyClient({ accounts: [["121", "PC49 BoA CK 3388"]] });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.missingAccounts).toEqual(["Inventory Purchase", "Sales"]);
  });

  it("reports a row already imported rather than counting it again", async () => {
    const first = await previewImport(companyClient(), "transactions", ROWS, MAPPING);
    const knownHash = String(first.rows[0].key);
    const sb = companyClient({ hashes: [knownHash] });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.duplicates).toBe(1);
    expect(preview.creates).toBe(1);
  });

  it("refuses a row with no amount, and keeps the others", async () => {
    const rows = [...ROWS, ["2026-01-17", "No amount", "121 - PC49 BoA CK 3388", "Sales", ""]];

    const preview = await previewImport(companyClient(), "transactions", rows, MAPPING);

    expect(preview.problems.some((problem) => /amount/i.test(problem.message))).toBe(true);
    expect(preview.creates).toBe(2);
  });
});

describe("runImport for transactions", () => {
  it("sends resolved rows and the chosen bank account to the RPC", async () => {
    const sb = companyClient();

    const outcome = await runImport(sb, "transactions", ROWS, MAPPING, {
      bankAccountId: "account-0",
    });

    expect(outcome.created).toBe(2);
    expect(sb.rpc).toHaveBeenCalledWith(
      "acc_import_transactions",
      expect.objectContaining({ p_default_bank_account_id: "account-0" }),
    );
    const sent = sb.rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] };
    expect(sent.p_rows[0]).toMatchObject({
      txn_date: "2026-01-15",
      category_account: "Inventory Purchase",
      signed_minor: -320000,
    });
    expect(String(sent.p_rows[0].raw_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to run when the bank account has no bank record", async () => {
    // Dedupe lives on the bank line's unique hash; without a bank record there
    // is none, and a second import would post the same money again.
    const sb = companyClient({ bankedIds: [] });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/no bank record/i);
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("refuses to run at all when an account is missing", async () => {
    const sb = companyClient({ accounts: [["121", "PC49 BoA CK 3388"]] });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/Inventory Purchase/);
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
