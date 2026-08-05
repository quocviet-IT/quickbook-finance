import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  voidPayment: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  voidPayment: mocks.voidPayment,
}));

import { voidPaymentAction } from "@/app/(app)/payments/actions";

const id = "11111111-1111-4111-8111-111111111111";
const paths = [
  "/payments",
  "/invoices",
  "/sales",
  "/dashboard",
  "/reports/ar-aging",
  "/reports/customer-statement",
  "/reports/cash-flow",
  "/reports/transactions",
];

describe("voidPaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("admin");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.voidPayment.mockResolvedValue(undefined);
  });

  it("rejects a non-writer before creating a database client", async () => {
    mocks.canWrite.mockReturnValue(false);

    await expect(voidPaymentAction(id, "Duplicate demo")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling the service", async () => {
    const result = await voidPaymentAction(id, "   ");

    expect(result).toMatchObject({ ok: false });
    expect(mocks.voidPayment).not.toHaveBeenCalled();
  });

  it("voids through the schema-bound client and revalidates every affected view", async () => {
    await expect(voidPaymentAction(id, "  Duplicate demo  ")).resolves.toEqual({ ok: true });

    expect(mocks.voidPayment).toHaveBeenCalledWith(
      { marker: "company-bound" },
      id,
      "Duplicate demo",
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
  });

  it("returns the database guard message", async () => {
    mocks.voidPayment.mockRejectedValue(new Error("Accounting period is closed"));

    await expect(voidPaymentAction(id, "Duplicate demo")).resolves.toEqual({
      ok: false,
      error: "Accounting period is closed",
    });
  });
});
