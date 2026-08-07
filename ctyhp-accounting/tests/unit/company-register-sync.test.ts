import { describe, expect, it, vi } from "vitest";
import { CompanyError, syncCompanyRegisterName } from "@/lib/services/company";

/** A register client that records the update it was asked to make. */
function stubRegister(result: { data?: unknown[]; error?: { message: string } }) {
  const update = vi.fn(() => ({
    eq: (column: string, value: string) => ({
      select: async () => {
        calls.push({ column, value });
        return { data: result.data ?? [{ id: "c1" }], error: result.error ?? null };
      },
    }),
  }));
  const calls: { column: string; value: string }[] = [];
  return { client: { from: () => ({ update }) } as never, update, calls };
}

describe("syncCompanyRegisterName", () => {
  it("renames the register row belonging to that company's schema", async () => {
    const { client, update, calls } = stubRegister({});
    await syncCompanyRegisterName(client, "co_pc_49", "Pacific Four Nine", null);

    expect(update).toHaveBeenCalledWith({ legal_name: "Pacific Four Nine", dba_name: null });
    expect(calls[0]).toEqual({ column: "schema_name", value: "co_pc_49" });
  });

  it("complains when no register row matched, rather than reporting success", async () => {
    // The switcher would keep showing the old name and nothing would say why.
    const { client } = stubRegister({ data: [] });
    await expect(
      syncCompanyRegisterName(client, "co_ghost", "Anything", null),
    ).rejects.toThrow(CompanyError);
  });

  it("does not swallow the database's own refusal", async () => {
    const { client } = stubRegister({ error: { message: "permission denied for table company" } });
    await expect(syncCompanyRegisterName(client, "co_pc_49", "X", null)).rejects.toThrow(
      "permission denied",
    );
  });
});
