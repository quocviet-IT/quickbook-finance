import { describe, expect, it } from "vitest";
import { createDraftInvoice, issueInvoice } from "@/lib/services/invoicing";
import { listCustomerCredit } from "@/lib/services/credit";
import { closeE2eSession, openE2eSession } from "./support/session";
import { sweepMarker } from "./support/cleanup";

const LIMIT_MINOR = 100_00; // $100.00

/**
 * The credit limit is only worth having if the database refuses the invoice
 * that breaks it. This signs in as an administrator — who holds
 * `credit.override` — so it can prove both halves: refused without a reason,
 * allowed with one, and the override written to the audit log.
 */
describe("customer credit control over HTTPS", () => {
  it("refuses to issue past the limit, and records the override that does", async () => {
    const { sb, marker, today } = await openE2eSession();

    try {
      await sweepMarker(sb, marker);

      const { data: customer, error: customerError } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD", credit_limit_minor: LIMIT_MINOR })
        .select("id")
        .single();
      expect(customerError).toBeNull();

      const { data: account } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "income")
        .eq("is_posting_account", true)
        .eq("status", "active")
        .limit(1)
        .single();

      const draft = (total: number) =>
        createDraftInvoice(sb, {
          customer_id: (customer as { id: string }).id,
          currency_code: "USD",
          issue_date: today,
          due_date: today,
          memo: marker,
          lines: [
            {
              description: "Credit control check",
              quantity: 1,
              unit_price_minor: total,
              income_account_id: (account as { id: string }).id,
              tax_code_id: null,
              item_id: null,
            },
          ],
        });

      // 1. Inside the limit: issues with no ceremony.
      const small = await draft(40_00);
      await issueInvoice(sb, small.id);

      // 2. A reason where none is needed is refused — the override must mean
      //    something, so it cannot be attached to an ordinary invoice.
      const second = await draft(30_00);
      await expect(issueInvoice(sb, second.id, "not needed")).rejects.toThrow(/no override is needed/i);
      await issueInvoice(sb, second.id);

      // 3. Over the limit: refused, even for an administrator, until a reason
      //    is given. Balance is $70; this one takes it to $170 against $100.
      const over = await draft(100_00);
      await expect(issueInvoice(sb, over.id)).rejects.toThrow(/credit override needs a written reason/i);

      // 4. With a reason it goes through and the override is logged as its own
      //    action, with the numbers it was decided on.
      await issueInvoice(sb, over.id, "Wire confirmed by the customer's bank, clearing tomorrow");

      const { data: overrides } = await sb
        .from("acc_audit_log")
        .select("action, after_json")
        .eq("table_name", "acc_invoice")
        .eq("record_id", over.id)
        .eq("action", "credit_override");
      expect(overrides, "the override must be in the audit log").toHaveLength(1);
      const logged = (overrides as { after_json: Record<string, unknown> }[])[0].after_json;
      expect(logged.reason).toContain("Wire confirmed");
      expect(Number(logged.credit_limit_minor)).toBe(LIMIT_MINOR);
      expect(Number(logged.open_balance_minor)).toBe(70_00);
      expect(Number(logged.invoice_total_minor)).toBe(100_00);

      // 5. The exposure the screens read comes from those invoices.
      const credit = await listCustomerCredit(sb);
      const row = credit.find((entry) => entry.name === marker)!;
      expect(row.openBalanceMinor).toBe(170_00);
      expect(row.creditLimitMinor).toBe(LIMIT_MINOR);
      expect(row.status.state).toBe("over_limit");
      expect(row.status.availableMinor).toBe(-70_00);

      // 6. Credit hold blocks the next invoice on its own, whatever the size.
      const { error: holdError } = await sb
        .from("acc_customer")
        .update({ credit_hold: true })
        .eq("id", (customer as { id: string }).id);
      expect(holdError).toBeNull();

      const tiny = await draft(1_00);
      await expect(issueInvoice(sb, tiny.id)).rejects.toThrow(/credit override needs a written reason/i);
    } finally {
      await sweepMarker(sb, marker);
      await closeE2eSession(sb);
    }
  });
});
