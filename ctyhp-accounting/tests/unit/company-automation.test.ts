import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runForAutomationCompanies,
  type AutomationCompany,
} from "@/lib/domain/company-automation";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const {
  createSupabaseAutomationClient,
  listActiveAutomationCompanies,
} = await import("@/lib/db/automation");

/**
 * A Supabase query chain that records what was asked and resolves once awaited,
 * so the registry query can be asserted without a database.
 */
function fakeRegistry(response: { data: unknown; error: { message: string } | null }) {
  const calls: { from?: string; select?: string; eq?: [string, string]; order: string[] } = {
    order: [],
  };
  const chain: Record<string, unknown> = {
    select(columns: string) {
      calls.select = columns;
      return chain;
    },
    eq(column: string, value: string) {
      calls.eq = [column, value];
      return chain;
    },
    order(column: string) {
      calls.order.push(column);
      return chain;
    },
    then(resolve: (value: typeof response) => unknown) {
      return Promise.resolve(response).then(resolve);
    },
  };
  const client = {
    from(table: string) {
      calls.from = table;
      return chain;
    },
  };
  return { client, calls };
}

function company(slug: string): AutomationCompany {
  return {
    id: `id-${slug}`,
    slug,
    schemaName: `co_${slug}`,
    legalName: `${slug} Holdings, Inc.`,
  };
}

/** Resolves after `ticks` microtask turns, so finish order can be forced. */
async function afterTicks<T>(ticks: number, value: T): Promise<T> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  return value;
}

describe("runForAutomationCompanies", () => {
  it("never runs more than the concurrency limit at once", async () => {
    const companies = ["one", "two", "three", "four", "five"].map((slug) => company(slug));
    let running = 0;
    let maxRunning = 0;

    await runForAutomationCompanies(companies, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await afterTicks(4, null);
      running -= 1;
      return "done";
    });

    expect(maxRunning).toBe(2);
  });

  it("keeps registry order even when workers finish out of order", async () => {
    // "one" deliberately finishes last so ordered output is proven, not assumed.
    const delays: Record<string, number> = { one: 20, two: 2, three: 8 };
    const companies = ["one", "two", "three"].map((slug) => company(slug));

    const results = await runForAutomationCompanies(companies, (target) =>
      afterTicks(delays[target.slug], target.slug.toUpperCase()),
    );

    expect(results.map((row) => row.company.slug)).toEqual(["one", "two", "three"]);
    expect(results.map((row) => (row.ok ? row.result : null))).toEqual(["ONE", "TWO", "THREE"]);
  });

  it("isolates one company's failure from the rest", async () => {
    const companies = ["one", "two", "three"].map((slug) => company(slug));

    const results = await runForAutomationCompanies(companies, async (target) => {
      if (target.slug === "two") throw new Error("two failed");
      return target.slug;
    });

    expect(results[0]).toMatchObject({ ok: true, result: "one" });
    expect(results[1]).toMatchObject({ ok: false, error: "two failed" });
    expect(results[2]).toMatchObject({ ok: true, result: "three" });
    expect(results[1].company.slug).toBe("two");
  });

  it("describes a thrown non-error without leaking its shape", async () => {
    const results = await runForAutomationCompanies([company("one")], async () => {
      throw "boom";
    });

    expect(results[0]).toMatchObject({ ok: false, error: "Company automation failed" });
  });

  it("returns nothing for an empty registry without calling the worker", async () => {
    let calls = 0;
    const results = await runForAutomationCompanies([], async () => {
      calls += 1;
      return null;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects a concurrency below one rather than stalling", async () => {
    await expect(
      runForAutomationCompanies([company("one")], async () => null, 0),
    ).rejects.toThrow(/concurrency/i);
  });
});

describe("createSupabaseAutomationClient", () => {
  beforeEach(() => {
    createClient.mockReset();
    createClient.mockReturnValue({});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-long-enough");
  });

  it("binds the client to the company schema it was asked for", () => {
    createSupabaseAutomationClient("co_north_star");

    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "service-role-key-long-enough",
      {
        db: { schema: "co_north_star" },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  });

  it("defaults to the first company's schema so existing callers do not move", () => {
    createSupabaseAutomationClient();

    expect(createClient.mock.calls[0][2]).toMatchObject({ db: { schema: "public" } });
  });

  it("refuses to run without a service-role key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createSupabaseAutomationClient("co_north_star")).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

describe("listActiveAutomationCompanies", () => {
  beforeEach(() => {
    createClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-long-enough");
  });

  it("reads active companies from the register in display order", async () => {
    const { client, calls } = fakeRegistry({
      data: [
        { id: "id-1", slug: "ctyhp", schema_name: "public", legal_name: "CTYHP" },
        { id: "id-2", slug: "aurora", schema_name: "co_aurora", legal_name: "Aurora Ltd" },
      ],
      error: null,
    });
    createClient.mockReturnValue(client);

    const companies = await listActiveAutomationCompanies();

    expect(createClient.mock.calls[0][2]).toMatchObject({ db: { schema: "onebook" } });
    expect(calls.from).toBe("company");
    expect(calls.select).toBe("id,slug,schema_name,legal_name");
    expect(calls.eq).toEqual(["status", "active"]);
    expect(calls.order).toEqual(["display_order", "legal_name"]);
    expect(companies).toEqual([
      { id: "id-1", slug: "ctyhp", schemaName: "public", legalName: "CTYHP" },
      { id: "id-2", slug: "aurora", schemaName: "co_aurora", legalName: "Aurora Ltd" },
    ]);
  });

  it("throws rather than reporting an empty register", async () => {
    const { client } = fakeRegistry({ data: null, error: { message: "permission denied" } });
    createClient.mockReturnValue(client);

    await expect(listActiveAutomationCompanies()).rejects.toThrow(/permission denied/);
  });
});
