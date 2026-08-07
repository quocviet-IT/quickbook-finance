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
  // The argument type is declared so the assertions below can read what was
  // sent; an argument-less mock hides the payload from the type checker.
  const rpc = vi.fn(async (_name: string, _args: RpcArgs) => ({
    data: response.data ?? null,
    error: response.error ?? null,
  }));
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

describe("voidImportBatch", () => {
  it("returns how many entries were voided", async () => {
    const { client } = stubClient({ data: 554 });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).resolves.toBe(554);
  });

  it("does not swallow a refusal", async () => {
    const { client } = stubClient({
      error: { message: "Cannot void an entry in a closed period" },
    });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).rejects.toThrow(
      "Cannot void an entry in a closed period",
    );
  });
});
