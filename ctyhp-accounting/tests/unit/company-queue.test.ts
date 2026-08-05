import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

const request = {
  id: "req-1",
  slug: "north_star",
  legal_name: "North Star Bridal LLC",
  is_sample: false,
  display_order: 100,
  requested_by: "user-1",
};

function fakeClient(claims: (Record<string, unknown> | null)[]) {
  const calls: string[] = [];
  let claimIndex = 0;
  return {
    calls,
    ended: false,
    async query(text: string) {
      calls.push(text);
      if (/claim_company_request/.test(text)) {
        const row = claims[claimIndex] ?? null;
        claimIndex += 1;
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async end() {
      this.ended = true;
    },
  };
}

const sources = [{ file: "0001.sql", sql: "select 1;" }];
const built = {
  companyId: "company-1",
  schema: "co_north_star",
  statementCount: 1053,
  tableCount: 100,
  functionCount: 400,
  policyCount: 300,
};

describe("runPendingCompanyProvisioning", () => {
  it("does nothing, and closes the connection, when the queue is empty", async () => {
    const client = fakeClient([null]);
    const provision = vi.fn();

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => sources,
    });

    expect(run.processed).toBe(0);
    expect(run.migrationFileCount).toBe(1);
    expect(provision).not.toHaveBeenCalled();
    expect(client.ended).toBe(true);
  });

  it("provisions a claimed request inside its own transaction and marks it ready", async () => {
    const client = fakeClient([request, null]);
    const provision = vi.fn().mockResolvedValue(built);

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => sources,
    });

    expect(run.processed).toBe(1);
    expect(run.results[0]).toMatchObject({ requestId: "req-1", slug: "north_star", ok: true });
    expect(provision).toHaveBeenCalledWith(
      client,
      {
        slug: "north_star",
        legalName: "North Star Bridal LLC",
        isSample: false,
        displayOrder: 100,
        adminUserIds: ["user-1"],
      },
      sources,
    );
    const order = client.calls.join("\n@@\n");
    expect(order.indexOf("begin")).toBeLessThan(order.indexOf("commit"));
    expect(order).toContain("complete_company_request");
  });

  it("rolls back and records the message when provisioning refuses", async () => {
    const client = fakeClient([request, null]);
    const provision = vi.fn().mockRejectedValue(new Error("co_north_star is not complete"));

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => sources,
    });

    expect(run.results[0]).toMatchObject({ ok: false, error: "co_north_star is not complete" });
    const order = client.calls.join("\n@@\n");
    expect(order).toContain("rollback");
    expect(order).toContain("fail_company_request");
    expect(order).not.toContain("complete_company_request");
    expect(client.ended).toBe(true);
  });

  it("stops after the batch limit even if more are waiting", async () => {
    const client = fakeClient([request, request, request]);
    const provision = vi.fn().mockResolvedValue(built);

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => sources,
      maxRequests: 2,
    });

    expect(run.processed).toBe(2);
  });
});
