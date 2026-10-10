import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRole: vi.fn(),
  executeOrSubmit: vi.fn(),
  createStockCount: vi.fn(),
  getBookValue: vi.fn(),
  getEntryNumber: vi.fn(),
  getStockCount: vi.fn(),
  markPending: vi.fn(),
  postStockCount: vi.fn(),
  saveStockCount: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: (role: string | null) => role === "admin" || role === "accountant",
}));
vi.mock("@/lib/services/approval-flow", () => ({ executeOrSubmitForApproval: mocks.executeOrSubmit }));
vi.mock("@/lib/services/stock-count", () => ({
  createStockCount: mocks.createStockCount,
  getBookValue: mocks.getBookValue,
  getEntryNumber: mocks.getEntryNumber,
  getStockCount: mocks.getStockCount,
  markStockCountPending: mocks.markPending,
  postStockCount: mocks.postStockCount,
  saveStockCount: mocks.saveStockCount,
}));

import { bookValueAction, createStockCountAction, postStockCountAction, saveStockCountAction } from "@/app/(app)/inventory/stock-count/actions";

const sb = { name: "company client" };
const ID = "6f1f5f6a-0000-4000-8000-000000000001";
const INV = "6f1f5f6a-0000-4000-8000-000000000002";
const ADJ = "6f1f5f6a-0000-4000-8000-000000000003";
const post = { id: ID, inventoryAccountId: INV, offsetAccountId: ADJ };

function draftCount(lines = [{ quantity: 10, unit_cost_minor: 250 }]) {
  return {
    count: { id: ID, count_number: "SC-000001", as_of: "2026-06-30", status: "draft" },
    lines,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(sb);
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.getStockCount.mockResolvedValue(draftCount());
  mocks.getBookValue.mockResolvedValue(1_000);
});

describe("postStockCountAction", () => {
  it("asks the approval flow about the size of the difference, with the count in the payload", async () => {
    mocks.executeOrSubmit.mockImplementation(async (o) => ({ status: "executed", result: await o.execute() }));
    mocks.postStockCount.mockResolvedValue("je1");
    mocks.getEntryNumber.mockResolvedValue("JE-000042");
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: true, data: { kind: "posted", entryId: "je1", entryNumber: "JE-000042" } });
    const options = mocks.executeOrSubmit.mock.calls[0][0];
    expect(options).toMatchObject({
      sb,
      actionKey: "inventory_adjustment",
      amountMinor: 1_500, // counted 2,500 less the books 1,000
      payload: { stock_count_id: ID, inventory_account_id: INV, offset_account_id: ADJ },
    });
    expect(mocks.postStockCount).toHaveBeenCalledWith(sb, post);
    expect(mocks.markPending).not.toHaveBeenCalled();
  });

  it("uses the size of a shortfall, not its sign", async () => {
    mocks.getBookValue.mockResolvedValue(10_000);
    mocks.executeOrSubmit.mockResolvedValue({ status: "executed", result: "je1" });
    await postStockCountAction(post);
    expect(mocks.executeOrSubmit.mock.calls[0][0].amountMinor).toBe(7_500);
  });

  it("marks the count pending when the policy sends it for approval", async () => {
    mocks.executeOrSubmit.mockResolvedValue({ status: "submitted", requestId: "r1" });
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: true, data: { kind: "submitted", requestId: "r1" } });
    expect(mocks.markPending).toHaveBeenCalledWith(sb, ID, "r1");
    expect(mocks.postStockCount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/approvals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/inventory/stock-count/${ID}`);
  });

  it("says so when the request went through but could not be linked to the count", async () => {
    mocks.executeOrSubmit.mockResolvedValue({ status: "submitted", requestId: "r1" });
    mocks.markPending.mockRejectedValue(new Error("That approval request is not a pending request for this stock count"));
    const r = await postStockCountAction(post);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sent for approval, but the count could not be linked");
  });

  it("refuses a count that already agrees with the books, before asking for approval", async () => {
    mocks.getBookValue.mockResolvedValue(2_500);
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: false, error: "The count agrees with the books." });
    expect(mocks.executeOrSubmit).not.toHaveBeenCalled();
  });

  it("refuses a count that is not a draft, or does not exist", async () => {
    mocks.getStockCount.mockResolvedValue({ ...draftCount(), count: { ...draftCount().count, status: "posted" } });
    expect((await postStockCountAction(post)).error).toContain("is not a draft");
    mocks.getStockCount.mockResolvedValue(null);
    expect((await postStockCountAction(post)).error).toBe("Stock count not found");
    expect(mocks.executeOrSubmit).not.toHaveBeenCalled();
  });

  it("puts a closed period in plain words", async () => {
    mocks.executeOrSubmit.mockRejectedValue(new Error("Accounting period for 2026-06-30 is closed"));
    const r = await postStockCountAction(post);
    expect(r).toEqual({
      ok: false,
      error: "That date falls in a closed accounting period. Choose a later date, or reopen the period.",
    });
  });

  it("refuses a viewer, and bad ids, without touching the database", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect((await postStockCountAction(post)).ok).toBe(false);
    mocks.getUserRole.mockResolvedValue("admin");
    expect((await postStockCountAction({ ...post, offsetAccountId: "x" })).error).toBe("Choose the offset account");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("saveStockCountAction", () => {
  const sheet = {
    id: ID,
    asOf: "2026-06-30",
    memo: null,
    lines: [{ name: "Bolt", sku: null, quantity: 3, unitCostMinor: 99, sellsForMinor: null }],
  };

  it("saves a valid sheet", async () => {
    mocks.saveStockCount.mockResolvedValue(1);
    expect(await saveStockCountAction(sheet)).toEqual({ ok: true, data: { saved: 1 } });
    expect(mocks.saveStockCount).toHaveBeenCalledWith(sb, sheet);
  });

  it("names the line a bad value is on, before any call", async () => {
    const r = await saveStockCountAction({ ...sheet, lines: [sheet.lines[0], { ...sheet.lines[0], name: " " }] });
    expect(r).toEqual({ ok: false, error: "Line 2: A name is required" });
    expect(mocks.saveStockCount).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect((await saveStockCountAction(sheet)).ok).toBe(false);
  });
});

describe("createStockCountAction", () => {
  it("opens or starts a count for the date", async () => {
    mocks.createStockCount.mockResolvedValue(ID);
    expect(await createStockCountAction("2026-06-30")).toEqual({ ok: true, data: { id: ID } });
    expect(mocks.createStockCount).toHaveBeenCalledWith(sb, "2026-06-30");
  });

  it("refuses a missing date", async () => {
    expect((await createStockCountAction("")).ok).toBe(false);
    expect(mocks.createStockCount).not.toHaveBeenCalled();
  });
});

describe("bookValueAction", () => {
  it("reads the books on the date", async () => {
    mocks.getBookValue.mockResolvedValue(4_200);
    expect(await bookValueAction("2026-06-30")).toEqual({ ok: true, data: { bookMinor: 4_200 } });
    expect(mocks.getBookValue).toHaveBeenCalledWith(sb, "2026-06-30");
  });
  it("refuses a date that is not a date", async () => {
    const r = await bookValueAction("soon");
    expect(r.ok).toBe(false);
    expect(mocks.getBookValue).not.toHaveBeenCalled();
  });
});
