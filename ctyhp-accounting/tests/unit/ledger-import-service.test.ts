import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { LedgerImportError, importLedgerBatch, voidImportBatch } = await import(
  "@/lib/services/ledger-import"
);

interface RpcArgs {
  p_mode: string;
  p_entries: { date: string; lines: unknown[] }[];
}

function stubClient(response: { data?: unknown; error?: { message: string } }) {
  // The signature is declared on the generic rather than as parameters, so the
  // assertions below can read what was sent without the mock carrying two
  // arguments it never looks at.
  const rpc = vi.fn<(name: string, args: RpcArgs) => Promise<{ data: unknown; error: unknown }>>(
    async () => ({ data: response.data ?? null, error: response.error ?? null }),
  );
  return { client: { rpc } as never, rpc };
}

const entries = [
  {
    date: "2023-01-02",
    lines: [
      { account: "121 - Checking", signedMinor: 120000, description: "Beginning Balance" },
      { account: "Opening Balance Equity", signedMinor: -120000, description: "Beginning Balance" },
    ],
  },
];

describe("importLedgerBatch", () => {
  it("sends snake_case lines, because that is what the function reads", async () => {
    const { client, rpc } = stubClient({ data: { batch_id: "b1", entries: 1, lines: 2 } });
    const result = await importLedgerBatch(client, {
      mode: "history",
      fileName: "ledger.csv",
      sha256: "a".repeat(64),
      entries,
    });
    expect(result).toEqual({ batchId: "b1", entries: 1, lines: 2 });
    const payload = rpc.mock.calls[0][1];
    expect(payload.p_mode).toBe("history");
    expect(payload.p_entries[0].lines[0]).toEqual({
      account: "121 - Checking",
      signed_minor: 120000,
      description: "Beginning Balance",
    });
  });

  it("refuses an empty file before troubling the database", async () => {
    const { client, rpc } = stubClient({ data: null });
    await expect(
      importLedgerBatch(client, {
        mode: "history",
        fileName: "ledger.csv",
        sha256: "a".repeat(64),
        entries: [],
      }),
    ).rejects.toThrow(LedgerImportError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal through", async () => {
    const { client } = stubClient({
      error: { message: "This file was already imported on 2026-08-06" },
    });
    await expect(
      importLedgerBatch(client, {
        mode: "history",
        fileName: "ledger.csv",
        sha256: "a".repeat(64),
        entries,
      }),
    ).rejects.toThrow("This file was already imported on 2026-08-06");
  });
});

/**
 * Undoing an import reads the batch's own source first, because the two kinds
 * of import are taken back in opposite ways: a ledger import is voided, an
 * invoice import's drafts are deleted. A screen that chose between them could
 * choose wrong; the batch cannot.
 */
function stubUndoClient(
  source: string,
  response: { data?: unknown; error?: { message: string } },
) {
  const rpc = vi.fn<(name: string, args: RpcArgs) => Promise<{ data: unknown; error: unknown }>>(
    async () => ({ data: response.data ?? null, error: response.error ?? null }),
  );
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { source }, error: null }) }),
    }),
  }));
  return { client: { rpc, from } as never, rpc };
}

describe("voidImportBatch", () => {
  it("voids the entries of a ledger import", async () => {
    const { client, rpc } = stubUndoClient("wave_ledger", { data: 554 });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).resolves.toEqual({
      removed: 554,
      kept: 0,
    });
    expect(rpc.mock.calls[0][0]).toBe("acc_void_import_batch");
  });

  it("deletes the drafts of an invoice import, and reports the ones it could not", async () => {
    const { client, rpc } = stubUndoClient("invoices", { data: [{ removed: 4, kept: 2 }] });
    await expect(voidImportBatch(client, "b1", "Wrong file")).resolves.toEqual({
      removed: 4,
      kept: 2,
    });
    expect(rpc.mock.calls[0][0]).toBe("acc_undo_invoice_import");
  });

  it("does not swallow a refusal", async () => {
    const { client } = stubUndoClient("wave_ledger", {
      error: { message: "Cannot void an entry in a closed period" },
    });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).rejects.toThrow(
      "Cannot void an entry in a closed period",
    );
  });
});
