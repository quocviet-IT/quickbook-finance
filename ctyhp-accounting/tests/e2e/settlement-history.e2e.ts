import { describe, expect, it } from "vitest";
import {
  createDraftInvoice,
  issueInvoice,
  recordPayment,
} from "@/lib/services/invoicing";
import { listInvoiceSettlements } from "@/lib/services/settlements";
import { getCashFlowForecast } from "@/lib/services/forecast";
import { buildSettlementHistory } from "@/lib/domain/settlement";
import { closeE2eSession, openE2eSession } from "./support/session";
import { sweepMarker } from "./support/cleanup";

/**
 * The payment history is read from three tables the application joins through
 * one RPC, and the forecast is read from two more. Only a real signed-in run
 * against the live schema proves those reads agree with the ledger.
 */
describe("settlement history and forecast over HTTPS", () => {
  it("shows every payment against an invoice, with the balance after each", async () => {
    const { sb, marker, today } = await openE2eSession();

    try {
      await sweepMarker(sb, marker);

      const { data: customer } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD" })
        .select("id")
        .single();
      const { data: income } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "income")
        .eq("is_posting_account", true)
        .eq("status", "active")
        .limit(1)
        .single();
      const { data: bank } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "bank")
        .eq("is_posting_account", true)
        .eq("status", "active")
        .limit(1)
        .single();
      expect(bank, "an active bank account is required to receive a payment").toBeTruthy();

      const invoice = await createDraftInvoice(sb, {
        customer_id: (customer as { id: string }).id,
        currency_code: "USD",
        issue_date: today,
        due_date: today,
        memo: marker,
        lines: [
          {
            description: "Settlement history check",
            quantity: 1,
            unit_price_minor: 1_000_00,
            income_account_id: (income as { id: string }).id,
            tax_code_id: null,
            item_id: null,
          },
        ],
      });
      await issueInvoice(sb, invoice.id);

      // Two part payments, the second carrying a check number.
      await recordPayment(sb, {
        customer_id: (customer as { id: string }).id,
        payment_date: today,
        currency_code: "USD",
        amount_minor: 400_00,
        deposit_account_id: (bank as { id: string }).id,
        method: "bank_transfer",
        reference: null,
        memo: marker,
        allocations: [{ invoice_id: invoice.id, amount_minor: 400_00 }],
      });
      await recordPayment(sb, {
        customer_id: (customer as { id: string }).id,
        payment_date: today,
        currency_code: "USD",
        amount_minor: 250_00,
        deposit_account_id: (bank as { id: string }).id,
        method: "check",
        reference: "CHK-10428",
        memo: marker,
        allocations: [{ invoice_id: invoice.id, amount_minor: 250_00 }],
      });

      const events = await listInvoiceSettlements(sb, invoice.id);
      expect(events, "both payments must appear against the invoice").toHaveLength(2);
      expect(events.every((event) => event.settlementType === "payment")).toBe(true);
      expect(
        events.some((event) => event.reference === "CHK-10428"),
        "the check number must survive the round trip",
      ).toBe(true);

      const { data: after } = await sb
        .from("acc_invoice")
        .select("total_minor, balance_due_minor, status")
        .eq("id", invoice.id)
        .single();
      const row = after as { total_minor: number; balance_due_minor: number; status: string };
      expect(row.balance_due_minor).toBe(350_00);
      expect(row.status).toBe("partial");

      // The history the screen builds must agree with the document's balance.
      const history = buildSettlementHistory({
        totalMinor: row.total_minor,
        balanceDueMinor: row.balance_due_minor,
        events,
      });
      expect(history.settledMinor).toBe(650_00);
      expect(history.lines.at(-1)!.balanceAfterMinor).toBe(350_00);
      expect(history.reconciles, "the settlements must add up to the ledger balance").toBe(true);

      // The forecast reads the same open balance, on the invoice's due date.
      const forecast = await getCashFlowForecast(sb, { asOf: today, weeks: 13 });
      const projectedIn = forecast.buckets.reduce((sum, b) => sum + b.expectedInMinor, 0);
      expect(
        projectedIn + forecast.beyondHorizonInMinor,
        "every open receivable belongs somewhere in the projection",
      ).toBe(forecast.totalOpenInMinor);
      expect(forecast.totalOpenInMinor).toBeGreaterThanOrEqual(350_00);
    } finally {
      await sweepMarker(sb, marker);
      await closeE2eSession(sb);
    }
  });
});
