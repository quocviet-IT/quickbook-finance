import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

/** The register note after an add: recorded, never decisive. */
const note = { upsert: vi.fn() };
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ upsert: (...args: unknown[]) => note.upsert(...args) }) }),
}));

const { AccessError, NOT_A_COLLEAGUE, addExistingUser } = await import("@/lib/services/access");

type Answer = { data: unknown; error: { message: string } | null };

function client(answers: Record<string, Answer>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(answers[fn] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const input = { email: "colleague@example.test", role: "viewer" as const };

beforeEach(() => {
  note.upsert.mockReset();
  note.upsert.mockResolvedValue({ error: null });
});

describe("addExistingUser (2.96)", () => {
  it("asks the register for a colleague, then adds that person by id with their own name", async () => {
    const register = client({ find_colleague: { data: [{ colleague_id: "u-7", colleague_name: "Pat Example" }], error: null } });
    const company = client({});
    expect(await addExistingUser(company.sb, register.sb, "company-1", input)).toBe("u-7");
    expect(register.calls).toEqual([{ fn: "find_colleague", args: { p_company_id: "company-1", p_email: "colleague@example.test" } }]);
    expect(company.calls).toEqual([
      { fn: "acc_add_company_user", args: { p_user_id: "u-7", p_full_name: "Pat Example", p_role: "viewer" } },
    ]);
    expect(note.upsert).toHaveBeenCalledWith({ company_id: "company-1", user_id: "u-7" }, { ignoreDuplicates: true });
  });

  it("gives one answer for every address that is not a colleague's, and adds nobody", async () => {
    const register = client({ find_colleague: { data: [], error: null } });
    const company = client({});
    await expect(addExistingUser(company.sb, register.sb, "company-1", input)).rejects.toThrow(NOT_A_COLLEAGUE);
    expect(company.calls).toEqual([]);
    expect(NOT_A_COLLEAGUE).not.toMatch(/no onebook sign-in|does not exist|not found/i);
  });

  it("passes the database's refusal on", async () => {
    const register = client({ find_colleague: { data: null, error: { message: "You do not have permission to manage users" } } });
    await expect(addExistingUser(client({}).sb, register.sb, "company-1", input)).rejects.toThrow(AccessError);
    const already = client({ acc_add_company_user: { data: null, error: { message: "This person is already in this company" } } });
    const found = client({ find_colleague: { data: [{ colleague_id: "u-7", colleague_name: "" }], error: null } });
    await expect(addExistingUser(already.sb, found.sb, "company-1", input)).rejects.toThrow("already in this company");
  });
});
