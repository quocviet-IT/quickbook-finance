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
  const accounts = (
    overrides.accounts ?? [
      ["121", "PC49 BoA CK 3388"],
      ["", "Inventory Purchase"],
      ["", "Sales"],
    ]
  ).map(([account_code, name], index) => ({ id: `account-${index}`, account_code, name }));

  /**
   * Stands in for `acc_account_ref_matches`, and must keep its precedence: the
   * code, then the code with its name, then the bare name — and no answer at
   * all when two accounts share that name. A fixture that resolves by any other
   * order would let the very bug this replaces back through the tests.
   */
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
    return { data: { imported: 2, skipped: 0 }, error: null };
  });
  /** The import call, ignoring the lookups the preview makes on the way. */
  const importCall = () =>
    rpc.mock.calls.find(([name]) => name === "acc_import_transactions") ?? null;
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      // The hash lookup reads in pages, because PostgREST caps a select at a
      // thousand rows without saying so. These fixtures are far short of a
      // page, so one call answers and the loop ends there.
      range: () => chain,
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
              : {
                  data: (overrides.hashes ?? []).map((raw_hash) => ({ raw_hash })),
                  error: null,
                },
        ).then(resolve),
    };
    return chain;
  };
  return { rpc, from, importCall } as unknown as SupabaseClient & {
    rpc: typeof rpc;
    importCall: typeof importCall;
  };
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

  it("counts a row with no money apart from the rows with problems", async () => {
    // A waived fee is written as 0.00 and there are 99 of them in the file the
    // tester imported. Calling that a problem told them to map a column they
    // had already mapped.
    const rows = [...ROWS, ["2026-01-17", "Fee waived", "121 - PC49 BoA CK 3388", "Sales", ""]];

    const preview = await previewImport(companyClient(), "transactions", rows, MAPPING);

    expect(preview.problems).toEqual([]);
    expect(preview.emptyRows).toBe(1);
    expect(preview.creates).toBe(2);
  });

  it("blocks a name two accounts answer to, and names both", async () => {
    // The chart this came from holds "1000 Cash on Hand" and "140 Cash on
    // Hand". The screen used to pick one and the import picked the other, so
    // the button went green and the import then refused.
    const sb = companyClient({
      accounts: [
        ["121", "PC49 BoA CK 3388"],
        ["", "Sales"],
        ["170", "Inventory Purchase"],
        ["510", "Inventory Purchase"],
      ],
    });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.ambiguousAccounts).toEqual([
      { ref: "Inventory Purchase", codes: ["170", "510"] },
    ]);
    // Not also reported as missing: the chart has it twice, not never.
    expect(preview.missingAccounts ?? []).toEqual([]);
  });

  it("takes the account code over a name another account also answers to", async () => {
    const sb = companyClient({
      accounts: [
        ["121", "PC49 BoA CK 3388"],
        ["", "Sales"],
        ["170", "Inventory Purchase"],
        ["510", "Inventory Purchase"],
      ],
    });
    const byCode = ROWS.map((row) => [...row.slice(0, 3), "170", row[4]]);

    const preview = await previewImport(sb, "transactions", byCode, MAPPING);

    expect(preview.ambiguousAccounts ?? []).toEqual([]);
    expect(preview.creates).toBe(2);
  });

  it("keeps two identical rows in one file as two transactions", async () => {
    // The bank charged the same wire fee twice on the same day. Both rows are
    // real; hashed alike, the second was dropped by the dedupe index without a
    // word, and the preview's count was one higher than what arrived.
    const twice = [
      ["2026-01-15", "Wire Transfer Fee", "121 - PC49 BoA CK 3388", "Sales", "-30.00"],
      ["2026-01-15", "Wire Transfer Fee", "121 - PC49 BoA CK 3388", "Sales", "-30.00"],
    ];

    const preview = await previewImport(companyClient(), "transactions", twice, MAPPING);

    expect(preview.creates).toBe(2);
    expect(preview.rows[0].key).not.toBe(preview.rows[1].key);
    expect(preview.duplicates ?? 0).toBe(0);
  });

  it("says once, not per row, that no money column is mapped", async () => {
    const withoutAmount = { ...MAPPING, amount: null, debit: null, credit: null };

    const preview = await previewImport(companyClient(), "transactions", ROWS, withoutAmount);

    expect(preview.problems).toHaveLength(1);
    expect(preview.problems[0].message).toMatch(/No money column is mapped/i);
    expect(preview.creates).toBe(0);
  });
});

describe("what the preview says about the rows it leaves out", () => {
  it("numbers a problem row by its line in the file, header included", async () => {
    // It reported "Row 543" for what a spreadsheet shows as line 544, because
    // it counted records rather than lines. Off by one, and further off after
    // any blank line, on the one message telling somebody where to look.
    const rows = [
      ["2026-01-15", "Zelle Transfer", "121 - PC49 BoA CK 3388", "Inventory Purchase", "-3200.00"],
      ["2026-01-16", "Check 1171", "121 - PC49 BoA CK 3388", "Sales", "-3450"],
    ];
    const mapping = { ...MAPPING, debit: 5, credit: 6 };
    const withConflict = rows.map((row, index) => [...row, index === 1 ? "2000" : "0", index === 1 ? "3450" : "0"]);

    const preview = await previewImport(companyClient(), "transactions", withConflict, mapping);

    // The second data row is line 3 of the file.
    expect(preview.problems[0].row).toBe(3);
  });

  it("keeps counting lines correctly past a blank one", async () => {
    const rows = [
      ["2026-01-15", "Zelle Transfer", "121 - PC49 BoA CK 3388", "Inventory Purchase", "-3200.00"],
      ["", "", "", "", ""],
      ["2026-01-17", "Fee waived", "121 - PC49 BoA CK 3388", "Sales", "0.00"],
    ];

    const preview = await previewImport(companyClient(), "transactions", rows, MAPPING);

    expect(preview.blankRows).toBe(1);
    // The waived fee is line 4 of the file, not the second surviving record.
    expect(preview.excluded?.map((row) => row.line)).toEqual([4]);
  });

  it("names every row it leaves out, with the reason", async () => {
    const rows = [...ROWS, ["2026-01-17", "Fee waived", "121 - PC49 BoA CK 3388", "Sales", ""]];

    const preview = await previewImport(companyClient(), "transactions", rows, MAPPING);

    expect(preview.excluded).toEqual([
      expect.objectContaining({ line: 4, reason: "No money" }),
    ]);
  });

  it("counts a row already imported among the ones left out", async () => {
    const first = await previewImport(companyClient(), "transactions", ROWS, MAPPING);
    const sb = companyClient({ hashes: [String(first.rows[0].key)] });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.excluded).toEqual([
      expect.objectContaining({ line: 2, reason: "Already imported" }),
    ]);
  });

  it("splits the total into money in and money out", async () => {
    // A single net figure hides a sign column read the wrong way round; these
    // two do not, which is the whole reason they are reported.
    const preview = await previewImport(companyClient(), "transactions", ROWS, MAPPING);

    expect(preview.moneyInMinor).toBe(96900);
    expect(preview.moneyOutMinor).toBe(-320000);
    expect((preview.moneyInMinor ?? 0) + (preview.moneyOutMinor ?? 0)).toBe(
      preview.openingTotalMinor,
    );
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
    const sent = sb.importCall()?.[1] as { p_rows: Record<string, unknown>[] };
    expect(sent.p_rows[0]).toMatchObject({
      txn_date: "2026-01-15",
      category_account: "Inventory Purchase",
      signed_minor: -320000,
    });
    expect(String(sent.p_rows[0].raw_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records what the import was, so it can be found and undone", async () => {
    const sb = companyClient();

    await runImport(sb, "transactions", ROWS, MAPPING, {
      bankAccountId: "account-0",
      fileName: "one-book-transactions.csv",
    });

    const sent = sb.importCall()?.[1] as Record<string, unknown>;
    expect(sent.p_file_name).toBe("one-book-transactions.csv");
    expect(String(sent.p_sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.p_line_count).toBe(ROWS.length);
  });

  it("names the file something rather than nothing when the screen sent none", async () => {
    // The register refuses a batch with no file name, and an import that fails
    // on a field the reader never saw is worse than a placeholder.
    const sb = companyClient();

    await runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" });

    const sent = sb.importCall()?.[1] as Record<string, unknown>;
    expect(String(sent.p_file_name).length).toBeGreaterThan(0);
  });

  it("refuses to run when the bank account has no bank record", async () => {
    // Dedupe lives on the bank line's unique hash; without a bank record there
    // is none, and a second import would post the same money again.
    const sb = companyClient({ bankedIds: [] });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/no bank record/i);
    expect(sb.importCall()).toBeNull();
  });

  it("refuses to run at all when an account is missing", async () => {
    const sb = companyClient({ accounts: [["121", "PC49 BoA CK 3388"]] });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/Inventory Purchase/);
    expect(sb.importCall()).toBeNull();
  });

  it("refuses to run when a name in the file belongs to two accounts", async () => {
    const sb = companyClient({
      accounts: [
        ["121", "PC49 BoA CK 3388"],
        ["", "Inventory Purchase"],
        ["", "Sales"],
        ["170", "Inventory Purchase"],
      ],
    });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/Inventory Purchase/);
    expect(sb.importCall()).toBeNull();
  });
});
