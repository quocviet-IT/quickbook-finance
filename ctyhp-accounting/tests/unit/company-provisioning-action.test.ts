import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClientForSchema: vi.fn(),
  runPending: vi.fn(),
  after: vi.fn((callback: () => unknown) => callback()),
  revalidatePath: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClientForSchema: mocks.createClientForSchema,
}));
vi.mock("@/lib/services/company-queue", () => ({
  runPendingCompanyProvisioning: mocks.runPending,
}));

import {
  getCompanyRequestAction,
  requestCompanyAction,
  retryCompanyRequestAction,
} from "@/app/(app)/settings/companies/actions";

function registerClient(
  overrides: { rpc?: unknown; row?: unknown; error?: { message: string } } = {},
) {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: overrides.rpc ?? "req-1", error: overrides.error ?? null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: overrides.row ?? null, error: null }),
  };
  return { rpc, from: () => chain };
}

const valid = { legal_name: "North Star Bridal LLC", slug: "north_star" };

describe("requestCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runPending.mockResolvedValue({ processed: 1, migrationFileCount: 96, results: [] });
  });

  it("rejects a name and key the register would refuse, before touching the database", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    const result = await requestCompanyAction({ legal_name: "", slug: "Bad Slug" });

    expect(result.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("queues the request against the register schema and starts the work after the response", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    const result = await requestCompanyAction(valid);

    expect(result).toEqual({ ok: true, data: { requestId: "req-1" } });
    expect(mocks.createClientForSchema).toHaveBeenCalledWith("onebook");
    expect(client.rpc).toHaveBeenCalledWith("request_company", {
      p_slug: "north_star",
      p_legal_name: "North Star Bridal LLC",
      p_is_sample: false,
      p_display_order: 100,
    });
    // Scheduled through `after`, so the browser is not holding the connection.
    expect(mocks.after).toHaveBeenCalled();
    expect(mocks.runPending).toHaveBeenCalled();
  });

  it("passes the database's refusal through unchanged", async () => {
    mocks.createClientForSchema.mockResolvedValue(
      registerClient({ error: { message: "Not authorized to create a company" } }),
    );

    await expect(requestCompanyAction(valid)).resolves.toEqual({
      ok: false,
      error: "Not authorized to create a company",
    });
    expect(mocks.runPending).not.toHaveBeenCalled();
  });

  it("keeps a queued request queued even if the worker cannot start", async () => {
    mocks.createClientForSchema.mockResolvedValue(registerClient());
    mocks.runPending.mockRejectedValue(
      new Error("This deployment has no database connection string"),
    );

    // The ask succeeded; the failure belongs to the worker and to the row.
    await expect(requestCompanyAction(valid)).resolves.toEqual({
      ok: true,
      data: { requestId: "req-1" },
    });
  });
});

describe("getCompanyRequestAction", () => {
  it("returns the row the register holds for this request", async () => {
    mocks.createClientForSchema.mockResolvedValue(
      registerClient({ row: { id: "req-1", status: "running", slug: "north_star", error: null } }),
    );

    await expect(getCompanyRequestAction("req-1")).resolves.toEqual({
      ok: true,
      data: { id: "req-1", status: "running", slug: "north_star", error: null },
    });
  });
});

describe("retryCompanyRequestAction", () => {
  it("asks the register to reopen the request and works the queue again", async () => {
    const client = registerClient({ rpc: null });
    mocks.createClientForSchema.mockResolvedValue(client);
    mocks.runPending.mockResolvedValue({ processed: 1, migrationFileCount: 96, results: [] });

    await expect(retryCompanyRequestAction("req-1")).resolves.toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("retry_company_request", { p_id: "req-1" });
    expect(mocks.runPending).toHaveBeenCalled();
  });
});
