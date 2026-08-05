import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BankingError,
  createBankCategory,
  listBankCategories,
  listBankTransactions,
  setBankTransactionCategory,
} from "@/lib/services/banking";

describe("createBankCategory", () => {
  it("asks the database to reuse a name it already knows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "category-1", error: null });

    const id = await createBankCategory({ rpc } as unknown as SupabaseClient, "  Inventory  ");

    expect(id).toBe("category-1");
    expect(rpc).toHaveBeenCalledWith("acc_upsert_bank_category", { p_name: "  Inventory  " });
  });

  it("surfaces the refusal as BankingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "A category name cannot exceed 60 characters" },
    });

    await expect(
      createBankCategory({ rpc } as unknown as SupabaseClient, "x".repeat(61)),
    ).rejects.toEqual(expect.any(BankingError));
  });
});

describe("setBankTransactionCategory", () => {
  it("attaches a label", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await setBankTransactionCategory({ rpc } as unknown as SupabaseClient, "txn-1", "category-1");

    expect(rpc).toHaveBeenCalledWith("acc_set_bank_transaction_category", {
      p_txn_id: "txn-1",
      p_category_id: "category-1",
    });
  });

  it("clears one with null rather than an empty string", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await setBankTransactionCategory({ rpc } as unknown as SupabaseClient, "txn-1", null);

    expect(rpc).toHaveBeenCalledWith("acc_set_bank_transaction_category", {
      p_txn_id: "txn-1",
      p_category_id: null,
    });
  });
});

describe("listBankCategories", () => {
  it("reads the active labels in name order", async () => {
    const asked: Record<string, unknown> = {};
    const chain = {
      select(columns: string) {
        asked.columns = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        asked.eq = [column, value];
        return chain;
      },
      order(column: string) {
        asked.order = column;
        return Promise.resolve({
          data: [{ id: "category-1", name: "Inventory", is_active: true }],
          error: null,
        });
      },
    };
    const sb = { from: () => chain } as unknown as SupabaseClient;

    const rows = await listBankCategories(sb);

    expect(asked.eq).toEqual(["is_active", true]);
    expect(asked.order).toBe("name");
    expect(rows).toEqual([{ id: "category-1", name: "Inventory", is_active: true }]);
  });
});

describe("listBankTransactions", () => {
  it("brings each line's label name with it, in one query", async () => {
    let asked = "";
    const chain = {
      select(columns: string) {
        asked = columns;
        return chain;
      },
      is: () => chain,
      eq: () => chain,
      order: () =>
        Promise.resolve({
          data: [
            {
              id: "txn-1",
              bank_category_id: "category-1",
              acc_bank_category: { name: "Inventory" },
            },
            { id: "txn-2", bank_category_id: null, acc_bank_category: null },
          ],
          error: null,
        }),
    };
    const sb = { from: () => chain } as unknown as SupabaseClient;

    const rows = await listBankTransactions(sb, null);

    expect(asked).toContain("acc_bank_category(name)");
    expect(rows[0].bank_category_name).toBe("Inventory");
    expect(rows[1].bank_category_name).toBeNull();
  });
});
