import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storage = { remove: vi.fn() };
vi.mock("@/lib/db/storage-admin", () => ({
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const { removeUnkeptUpload, tieKeptStatementFile } = await import("@/lib/services/statement-files");

const folder = "co_example";
const good = `${folder}/6d0f1e2a-1111-4222-8333-444455556666.pdf`;

/** A client whose row lookup answers `row` for any path. */
function stubClient(row: { id: string } | null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }),
  } as never;
}

beforeEach(() => {
  storage.remove.mockReset();
  storage.remove.mockResolvedValue({ data: [], error: null });
});

describe("removeUnkeptUpload", () => {
  it.each([
    ["a path in another folder", "co_other/6d0f1e2a-1111-4222-8333-444455556666.pdf"],
    ["a nested path", `${folder}/sub/6d0f1e2a-1111-4222-8333-444455556666.pdf`],
    ["a .. path", `${folder}/../6d0f1e2a-1111-4222-8333-444455556666.pdf`],
    ["a non-UUID name", `${folder}/statement.pdf`],
  ])("does not delete %s", async (_label, path) => {
    await removeUnkeptUpload(stubClient(null), folder, path);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("does not delete anything for a malformed folder", async () => {
    await removeUnkeptUpload(stubClient(null), "co/../x", "co/../x/6d0f1e2a-1111-4222-8333-444455556666.pdf");
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("deletes a well-formed path no row names", async () => {
    await removeUnkeptUpload(stubClient(null), folder, good);
    expect(storage.remove).toHaveBeenCalledWith([good]);
  });

  it("does not delete a well-formed path a row names", async () => {
    await removeUnkeptUpload(stubClient({ id: "row" }), folder, good);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("tieKeptStatementFile", () => {
  /** A client whose link RPCs answer `error`, recording what they were called with. */
  function rpcClient(error: { message: string } | null) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const sb = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: null, error };
      },
    } as never;
    return { sb, calls };
  }

  it("ties a file to its import, and says nothing", async () => {
    const { sb, calls } = rpcClient(null);
    expect(await tieKeptStatementFile(sb, "import", "batch-1", "file-1")).toBeNull();
    expect(calls).toEqual([{ fn: "acc_link_import_batch_statement_file", args: { p_batch_id: "batch-1", p_file_id: "file-1" } }]);
  });

  it("ties a file to a reconciliation", async () => {
    const { sb, calls } = rpcClient(null);
    expect(await tieKeptStatementFile(sb, "reconciliation", "rec-1", "file-1")).toBeNull();
    expect(calls).toEqual([
      { fn: "acc_link_reconciliation_statement_file", args: { p_reconciliation_id: "rec-1", p_file_id: "file-1" } },
    ]);
  });

  it("returns what the screen says when the file cannot be tied, instead of failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb } = rpcClient({ message: "This import already has a statement file" });
    expect(await tieKeptStatementFile(sb, "import", "batch-1", "file-1")).toBe(
      "The statement file was kept but could not be tied to this import: This import already has a statement file. It is in Reports › Saved.",
    );
    expect(await tieKeptStatementFile(sb, "reconciliation", "rec-1", "file-1")).toBe(
      "The statement file was kept but could not be tied to this reconciliation: This import already has a statement file. Attach it on the reconciliation.",
    );
    warn.mockRestore();
  });
});
