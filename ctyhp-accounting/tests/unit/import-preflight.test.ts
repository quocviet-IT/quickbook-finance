import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { importPreflight } from "@/lib/services/import-preflight";
import { previewImport } from "@/lib/services/data-import";

const MAPPING = {
  txn_date: 0,
  description: 1,
  bank_account: 2,
  category_account: 3,
  amount: 4,
  debit: null,
  credit: null,
};

const ROWS = [
  ["2026-01-15", "Card fee", "121 - PC49 BoA CK 3388", "Bank Charges", "-32.00"],
  ["2026-01-16", "Deposit", "121 - PC49 BoA CK 3388", "Sales", "969.00"],
  ["2026-01-17", "Wire out", "Petty Tin", "Transfer from PERFBUS", "-30.00"],
];

/**
 * A chart and a Banking register, answering the way the database does.
 *
 * `matchRef` keeps the resolver's precedence — code, then code and name, then
 * the bare name, and no answer when two live accounts share it. A fixture that
 * resolved by any other rule would let the screen pass a file the import
 * refuses, which is the bug this whole path exists to prevent.
 */
function companyClient(
  overrides: { accounts?: [string, string, string][]; bankedIds?: string[] } = {},
) {
  const accounts = (
    overrides.accounts ?? [
      ["121", "PC49 BoA CK 3388", "bank"],
      ["", "Bank Charges", "expense"],
      ["", "Sales", "income"],
      ["140", "Petty Tin", "current_asset"],
    ]
  ).map(([account_code, name, account_type], index) => ({
    id: `account-${index}`,
    account_code,
    name,
    account_type,
    status: "active",
  }));

  function matchRef(ref: string) {
    const key = (text: string) => text.trim().toLowerCase().replace(/[‐-―]/g, "-");
    const wanted = key(ref);
    const byCode = accounts.find((a) => a.account_code && key(a.account_code) === wanted);
    if (byCode) return { ref, account_id: byCode.id, matched_by: "code", candidate_codes: [] };
    const byPair = accounts.find((a) => key(`${a.account_code} - ${a.name}`) === wanted);
    if (byPair) return { ref, account_id: byPair.id, matched_by: "code_and_name", candidate_codes: [] };
    const byName = accounts.filter((a) => key(a.name) === wanted);
    if (byName.length === 1) {
      return { ref, account_id: byName[0].id, matched_by: "name", candidate_codes: [] };
    }
    if (byName.length > 1) {
      return {
        ref,
        account_id: null,
        matched_by: "ambiguous",
        candidate_codes: byName.map((a) => a.account_code).sort(),
      };
    }
    return { ref, account_id: null, matched_by: null, candidate_codes: [] };
  }

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "acc_account_ref_matches") {
      const refs = ((args?.p_refs as string[]) ?? []).map((r) => r.trim());
      return { data: refs.map(matchRef), error: null };
    }
    return { data: { imported: 0, skipped: 0 }, error: null };
  });

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
            ? { data: accounts, error: null }
            : table === "acc_bank_account"
              ? {
                  data: (overrides.bankedIds ?? ["account-0"]).map((account_id) => ({
                    account_id,
                  })),
                  error: null,
                }
              : { data: [], error: null },
        ).then(resolve),
    };
    return chain;
  };
  return { rpc, from } as unknown as SupabaseClient & { rpc: typeof rpc };
}

describe("importPreflight", () => {
  it("says what the file needs before a column is agreed", async () => {
    const result = await importPreflight(companyClient(), "transactions", ROWS, MAPPING);

    expect(result.chartAccounts).toBe(4);
    expect(result.bankAccounts).toBe(1);
    expect(result.bankRefs).toBe(2);
    expect(result.categoryRefs).toBe(3);
  });

  it("names what the chart cannot resolve, and which column it came from", async () => {
    const result = await importPreflight(companyClient(), "transactions", ROWS, MAPPING);

    const refs = result.unresolved.map((row) => row.ref);
    expect(refs).toContain("Transfer from PERFBUS");
    const missing = result.unresolved.find((row) => row.ref === "Transfer from PERFBUS");
    expect(missing?.column).toBe("category");
    expect(missing?.rows).toBe(1);
  });

  it("separates a bank with no Banking record from one that can never have one", async () => {
    const result = await importPreflight(companyClient(), "transactions", ROWS, MAPPING);

    // "Petty Tin" resolves to a current asset used as a bank in the file.
    const tin = result.unbanked.find((row) => row.ref === "Petty Tin");
    expect(tin?.accountCode).toBe("140");
    expect(tin?.canBeBanked).toBe(false);
  });

  it("counts a bank-type account with no record as one that can be fixed", async () => {
    const sb = companyClient({ bankedIds: [] });

    const result = await importPreflight(sb, "transactions", ROWS, MAPPING);

    const boa = result.unbanked.find((row) => row.accountCode === "121");
    expect(boa?.canBeBanked).toBe(true);
    expect(boa?.rows).toBe(2);
  });

  it("stops reporting a name the reader has already answered", async () => {
    const result = await importPreflight(companyClient(), "transactions", ROWS, MAPPING, {
      "Transfer from PERFBUS": "140",
    });

    expect(result.unresolved.map((row) => row.ref)).not.toContain("Transfer from PERFBUS");
  });

  it("orders the worst problem first", async () => {
    const sb = companyClient({ bankedIds: [] });

    const result = await importPreflight(sb, "transactions", ROWS, MAPPING);

    expect(result.unbanked[0].rows).toBeGreaterThanOrEqual(result.unbanked[1]?.rows ?? 0);
  });
});

describe("an override reaches the import, not just the screen", () => {
  it("resolves the name the reader pointed at an account", async () => {
    const plain = await previewImport(companyClient(), "transactions", ROWS, MAPPING);
    expect(plain.missingAccounts).toContain("Transfer from PERFBUS");

    const answered = await previewImport(companyClient(), "transactions", ROWS, MAPPING, {
      accountOverrides: { "Transfer from PERFBUS": "140" },
    });

    expect(answered.missingAccounts ?? []).toEqual([]);
  });

  it("sends the code, so the server resolves it the one way it resolves everything", async () => {
    const preview = await previewImport(companyClient(), "transactions", ROWS, MAPPING, {
      accountOverrides: { "Transfer from PERFBUS": "140" },
    });

    const row = preview.rows.find((entry) => entry.values.description === "Wire out");
    expect(row?.values.category_account).toBe("140");
    // And the untouched column is left exactly as the file wrote it.
    expect(row?.values.bank_account).toBe("Petty Tin");
  });
});
