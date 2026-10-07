import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storage = { remove: vi.fn() };
vi.mock("@/lib/db/storage-admin", () => ({
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const { removeUnkeptUpload } = await import("@/lib/services/statement-files");

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
