import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two reads the customer page makes after it arrives (3.0.12): the
 * Transactions tab's range and the Activity tab's change history.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  hasPermission: vi.fn(),
  searchAudit: vi.fn(),
  listCustomerTransactions: vi.fn(),
}));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/access", () => ({
  hasPermission: mocks.hasPermission,
  searchAudit: mocks.searchAudit,
  AccessError: class AccessError extends Error {},
}));
vi.mock("@/lib/services/customer-detail", () => ({
  listCustomerTransactions: mocks.listCustomerTransactions,
  CustomerDetailError: class CustomerDetailError extends Error {},
}));

import {
  getCustomerActivityAction,
  getCustomerTransactionsAction,
} from "@/app/(app)/customers/[id]/actions";

const sb = { name: "company client" };
const ID = "6f1c2a8e-3b4d-4c5e-8f9a-0b1c2d3e4f5a";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(sb);
});

describe("getCustomerTransactionsAction", () => {
  it("reads this customer's documents for the range", async () => {
    mocks.listCustomerTransactions.mockResolvedValue([{ id: "t1" }]);
    const res = await getCustomerTransactionsAction(ID, { from: "2025-11-10", to: "2026-11-10" });
    expect(res).toEqual({ ok: true, data: [{ id: "t1" }] });
    expect(mocks.listCustomerTransactions).toHaveBeenCalledWith(sb, ID, { from: "2025-11-10", to: "2026-11-10" });
  });

  it("reads every date when the range is open at both ends", async () => {
    mocks.listCustomerTransactions.mockResolvedValue([]);
    await getCustomerTransactionsAction(ID, { from: null, to: null });
    expect(mocks.listCustomerTransactions).toHaveBeenCalledWith(sb, ID, { from: null, to: null });
  });

  it("refuses an id or a date that is not one, without reading", async () => {
    expect(await getCustomerTransactionsAction("not-an-id", { from: null, to: null })).toEqual({
      ok: false,
      error: "Customer not found",
    });
    expect((await getCustomerTransactionsAction(ID, { from: "last year", to: null })).ok).toBe(false);
    expect(mocks.listCustomerTransactions).not.toHaveBeenCalled();
  });

  it("says why a read failed", async () => {
    mocks.listCustomerTransactions.mockRejectedValue(new Error("permission denied for table acc_payment"));
    expect(await getCustomerTransactionsAction(ID, { from: null, to: null })).toEqual({
      ok: false,
      error: "permission denied for table acc_payment",
    });
  });
});

describe("getCustomerActivityAction", () => {
  it("reads the customer's own audit trail", async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.searchAudit.mockResolvedValue([{ id: "a1" }]);
    const res = await getCustomerActivityAction(ID);
    expect(res).toEqual({ ok: true, data: [{ id: "a1" }] });
    expect(mocks.hasPermission).toHaveBeenCalledWith(sb, "audit.read");
    expect(mocks.searchAudit).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({ table_name: "acc_customer", record_id: ID, limit: 200 }),
    );
  });

  it("reads nothing for a role without audit.read", async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const res = await getCustomerActivityAction(ID);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("audit.read");
    expect(mocks.searchAudit).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one", async () => {
    expect(await getCustomerActivityAction("x")).toEqual({ ok: false, error: "Customer not found" });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });
});
