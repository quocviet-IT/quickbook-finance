import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InvoicingError,
  correctPayment,
  getPaymentDetail,
  updatePaymentDetails,
} from "@/lib/services/invoicing";

const id = "11111111-1111-4111-8111-111111111111";

describe("updatePaymentDetails", () => {
  it("sends the three description fields to the whitelist RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await updatePaymentDetails({ rpc } as unknown as SupabaseClient, {
      payment_id: id,
      method: "check",
      reference: null,
      memo: "Deposited Monday",
    });

    expect(rpc).toHaveBeenCalledWith("acc_update_payment_details", {
      p_payment_id: id,
      p_method: "check",
      p_reference: null,
      p_memo: "Deposited Monday",
    });
  });

  it("surfaces the refusal as InvoicingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "A void payment cannot be edited; record a replacement instead" },
    });

    await expect(
      updatePaymentDetails({ rpc } as unknown as SupabaseClient, {
        payment_id: id,
        method: null,
        reference: null,
        memo: null,
      }),
    ).rejects.toEqual(expect.any(InvoicingError));
  });
});

describe("correctPayment", () => {
  it("passes the receipt in the order acc_record_payment expects and returns the new id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "new-payment", error: null });

    const created = await correctPayment({ rpc } as unknown as SupabaseClient, {
      payment_id: id,
      reason: "Wrong amount",
      customer_id: "customer-1",
      payment_date: "2026-08-04",
      currency_code: "USD",
      amount_minor: 12550,
      deposit_account_id: "account-1",
      method: "check",
      reference: "CHK-104",
      memo: null,
      allocations: [{ invoice_id: "invoice-1", amount_minor: 12550 }],
    });

    expect(created).toBe("new-payment");
    expect(rpc).toHaveBeenCalledWith("acc_correct_payment", {
      p_payment_id: id,
      p_reason: "Wrong amount",
      p_customer_id: "customer-1",
      p_payment_date: "2026-08-04",
      p_currency: "USD",
      p_amount_minor: 12550,
      p_deposit_account_id: "account-1",
      p_method: "check",
      p_reference: "CHK-104",
      p_memo: null,
      p_allocations: [{ invoice_id: "invoice-1", amount_minor: 12550 }],
    });
  });

  it("lets the database refusal through", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Cannot void an entry in a closed period (2026-01-31)" },
    });

    await expect(
      correctPayment({ rpc } as unknown as SupabaseClient, {
        payment_id: id,
        reason: "Wrong amount",
        customer_id: "customer-1",
        payment_date: "2026-01-15",
        currency_code: "USD",
        amount_minor: 100,
        deposit_account_id: "account-1",
        method: null,
        reference: null,
        memo: null,
        allocations: [],
      }),
    ).rejects.toThrow(/closed period/);
  });
});

describe("getPaymentDetail", () => {
  it("reads the allocations and the journal entry behind a receipt", async () => {
    const asked: Record<string, string> = {};
    const allocationChain = {
      select(columns: string) {
        asked.allocations = columns;
        return allocationChain;
      },
      eq() {
        return allocationChain;
      },
      order() {
        return Promise.resolve({
          data: [
            {
              id: "alloc-1",
              amount_minor: 5000,
              invoice_id: "invoice-1",
              acc_invoice: {
                invoice_number: "INV-0001",
                total_minor: 12000,
                balance_due_minor: 7000,
                status: "partial",
                currency_code: "USD",
              },
            },
          ],
          error: null,
        });
      },
    };
    const entryChain = {
      select(columns: string) {
        asked.entry = columns;
        return entryChain;
      },
      eq() {
        return entryChain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: {
            id: "entry-1",
            entry_number: "JE-0009",
            entry_date: "2026-08-04",
            status: "posted",
            acc_journal_line: [
              {
                line_order: 2,
                debit_minor: 0,
                credit_minor: 5000,
                memo: null,
                acc_account: { account_code: "1100", name: "Accounts Receivable" },
              },
              {
                line_order: 1,
                debit_minor: 5000,
                credit_minor: 0,
                memo: null,
                acc_account: { account_code: "1010", name: "Checking" },
              },
            ],
          },
          error: null,
        });
      },
    };
    const sb = {
      from: (table: string) => (table === "acc_payment_allocation" ? allocationChain : entryChain),
    } as unknown as SupabaseClient;

    const detail = await getPaymentDetail(sb, { id, journal_entry_id: "entry-1" });

    expect(asked.allocations).toContain("acc_invoice(invoice_number");
    expect(detail.allocations).toEqual([
      {
        invoiceId: "invoice-1",
        invoiceNumber: "INV-0001",
        amountMinor: 5000,
        invoiceTotalMinor: 12000,
        invoiceBalanceMinor: 7000,
        invoiceStatus: "partial",
        currencyCode: "USD",
      },
    ]);
    expect(detail.journal?.entryNumber).toBe("JE-0009");
    // Sorted by line_order, not by the order PostgREST happened to return.
    expect(detail.journal?.lines.map((line) => line.accountCode)).toEqual(["1010", "1100"]);
  });

  it("reports no journal entry rather than failing when the receipt has none", async () => {
    const allocationChain = {
      select: () => allocationChain,
      eq: () => allocationChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    const sb = { from: () => allocationChain } as unknown as SupabaseClient;

    const detail = await getPaymentDetail(sb, { id, journal_entry_id: null });

    expect(detail.allocations).toEqual([]);
    expect(detail.journal).toBeNull();
  });
});
