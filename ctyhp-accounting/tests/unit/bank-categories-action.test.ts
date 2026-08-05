import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  getSessionUser: vi.fn(),
  createClient: vi.fn(),
  createBankCategory: vi.fn(),
  setBankTransactionCategory: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: mocks.canWrite,
  getSessionUser: mocks.getSessionUser,
}));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/banking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/banking")>()),
  createBankCategory: mocks.createBankCategory,
  setBankTransactionCategory: mocks.setBankTransactionCategory,
}));

import {
  createBankCategoryAction,
  setBankTransactionCategoryAction,
} from "@/app/(app)/banking/actions";

describe("bank category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("accountant");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.createBankCategory.mockResolvedValue("category-1");
    mocks.setBankTransactionCategory.mockResolvedValue(undefined);
  });

  it("refuses a reader before opening a database client", async () => {
    mocks.canWrite.mockReturnValue(false);

    await expect(createBankCategoryAction("Inventory")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    await expect(setBankTransactionCategoryAction("txn-1", "category-1")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses an empty name without asking the database", async () => {
    const result = await createBankCategoryAction("   ");

    expect(result.ok).toBe(false);
    expect(mocks.createBankCategory).not.toHaveBeenCalled();
  });

  it("returns the label the database settled on, trimmed", async () => {
    await expect(createBankCategoryAction("  Website Platform  ")).resolves.toEqual({
      ok: true,
      data: { id: "category-1", name: "Website Platform" },
    });
    expect(mocks.createBankCategory).toHaveBeenCalledWith(
      { marker: "company-bound" },
      "Website Platform",
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/banking"]);
  });

  it("attaches and clears a label, and revalidates the screen", async () => {
    await expect(setBankTransactionCategoryAction("txn-1", "category-1")).resolves.toEqual({
      ok: true,
    });
    expect(mocks.setBankTransactionCategory).toHaveBeenCalledWith(
      { marker: "company-bound" },
      "txn-1",
      "category-1",
    );

    await expect(setBankTransactionCategoryAction("txn-1", null)).resolves.toEqual({ ok: true });
    expect(mocks.setBankTransactionCategory).toHaveBeenLastCalledWith(
      { marker: "company-bound" },
      "txn-1",
      null,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/banking", "/banking"]);
  });

  it("passes the database's refusal through unchanged", async () => {
    mocks.setBankTransactionCategory.mockRejectedValue(new Error("That category does not exist"));

    await expect(setBankTransactionCategoryAction("txn-1", "gone")).resolves.toEqual({
      ok: false,
      error: "That category does not exist",
    });
  });
});
