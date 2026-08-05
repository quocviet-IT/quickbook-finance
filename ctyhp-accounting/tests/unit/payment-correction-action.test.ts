import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  updatePaymentDetails: vi.fn(),
  correctPayment: vi.fn(),
  getPaymentDetail: vi.fn(),
  searchAudit: vi.fn(),
  hasPermission: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/access", () => ({
  searchAudit: mocks.searchAudit,
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  updatePaymentDetails: mocks.updatePaymentDetails,
  correctPayment: mocks.correctPayment,
  getPaymentDetail: mocks.getPaymentDetail,
}));

import {
  correctPaymentAction,
  getPaymentAuditAction,
  getPaymentDetailAction,
  updatePaymentDetailsAction,
} from "@/app/(app)/payments/actions";

const id = "11111111-1111-4111-8111-111111111111";
const customer = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
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

const correction = {
  payment_id: id,
  reason: "  Wrong amount  ",
  customer_id: customer,
  currency_code: "USD",
  amount_minor: 12550,
  deposit_account_id: account,
  allocations: [],
};

describe("payment detail and correction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("admin");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.updatePaymentDetails.mockResolvedValue(undefined);
    mocks.correctPayment.mockResolvedValue("new-payment");
    mocks.getPaymentDetail.mockResolvedValue({ allocations: [], journal: null });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.searchAudit.mockResolvedValue([{ id: "audit-1" }]);
  });

  it("reads a detail through the company-bound client", async () => {
    await expect(getPaymentDetailAction({ id, journal_entry_id: "entry-1" })).resolves.toEqual({
      ok: true,
      data: { allocations: [], journal: null },
    });
    expect(mocks.getPaymentDetail).toHaveBeenCalledWith(
      { marker: "company-bound" },
      { id, journal_entry_id: "entry-1" },
    );
  });

  it("refuses the audit trail without the audit.read permission", async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(getPaymentAuditAction(id)).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.searchAudit).not.toHaveBeenCalled();
  });

  it("asks the audit log for this payment's own record", async () => {
    await expect(getPaymentAuditAction(id)).resolves.toEqual({
      ok: true,
      data: [{ id: "audit-1" }],
    });
    expect(mocks.searchAudit).toHaveBeenCalledWith(
      { marker: "company-bound" },
      expect.objectContaining({ table_name: "acc_payment", record_id: id, limit: 200 }),
    );
  });

  it("rejects a description edit from a non-writer before opening a client", async () => {
    mocks.canWrite.mockReturnValue(false);

    await expect(updatePaymentDetailsAction({ payment_id: id })).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("saves trimmed description fields and revalidates the payments list", async () => {
    await expect(
      updatePaymentDetailsAction({ payment_id: id, method: " check ", reference: "", memo: null }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updatePaymentDetails).toHaveBeenCalledWith(
      { marker: "company-bound" },
      { payment_id: id, method: "check", reference: null, memo: null },
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/payments"]);
  });

  it("rejects a correction without a reason before calling the service", async () => {
    const result = await correctPaymentAction({ ...correction, reason: "   " });

    expect(result).toMatchObject({ ok: false });
    expect(mocks.correctPayment).not.toHaveBeenCalled();
  });

  it("corrects through the service and revalidates every affected view", async () => {
    await expect(correctPaymentAction(correction)).resolves.toEqual({
      ok: true,
      data: { id: "new-payment" },
    });
    expect(mocks.correctPayment).toHaveBeenCalledWith(
      { marker: "company-bound" },
      expect.objectContaining({ payment_id: id, reason: "Wrong amount" }),
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
  });

  it("returns the database guard message from a correction", async () => {
    mocks.correctPayment.mockRejectedValue(
      new Error("Reject or undo the bank match before voiding this payment"),
    );

    await expect(correctPaymentAction(correction)).resolves.toEqual({
      ok: false,
      error: "Reject or undo the bank match before voiding this payment",
    });
  });
});
