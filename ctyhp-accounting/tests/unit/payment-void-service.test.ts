import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvoicingError, voidPayment } from "@/lib/services/invoicing";

describe("voidPayment", () => {
  it("delegates to the company-bound client's atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await voidPayment({ rpc } as unknown as SupabaseClient, "payment-1", "Demo entered twice");

    expect(rpc).toHaveBeenCalledWith("acc_void_payment", {
      p_payment_id: "payment-1",
      p_reason: "Demo entered twice",
    });
  });

  it("surfaces the database refusal as InvoicingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Reject or undo the bank match before voiding this payment" },
    });

    await expect(
      voidPayment({ rpc } as unknown as SupabaseClient, "payment-1", "Duplicate"),
    ).rejects.toEqual(expect.any(InvoicingError));
    await expect(
      voidPayment({ rpc } as unknown as SupabaseClient, "payment-1", "Duplicate"),
    ).rejects.toThrow("Reject or undo the bank match before voiding this payment");
  });
});

describe("listPayments", () => {
  it("reads the attribution and the reference a replacement needs", async () => {
    const captured: string[] = [];
    const chain = {
      select(columns: string) {
        captured.push(columns);
        return chain;
      },
      order() {
        return Promise.resolve({ data: [], error: null });
      },
    };
    const sb = { from: () => chain } as unknown as SupabaseClient;
    const { listPayments } = await import("@/lib/services/invoicing");

    await listPayments(sb);

    const columns = captured.join(",");
    for (const column of ["voided_at", "voided_by", "void_reason", "reference"]) {
      expect(columns, column).toContain(column);
    }
  });
});
