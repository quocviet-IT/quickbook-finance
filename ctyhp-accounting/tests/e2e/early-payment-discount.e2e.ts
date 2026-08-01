import { describe, expect, it } from "vitest";
import {
  closeE2eSession,
  createE2eServiceClient,
  openE2eSession,
} from "./support/session";

function serviceClient() {
  return createE2eServiceClient();
}

const today = new Date().toISOString().slice(0, 10);

/**
 * Taking an early payment discount, end to end on the real schema.
 *
 * The claim under test is an accounting one: paying less cash settles the bill
 * in full, and the difference lands in income rather than vanishing. If the
 * three legs did not balance the database would refuse the entry outright, so
 * what this really proves is that they are the *right* three legs.
 */
describe("early payment discount over HTTPS", () => {
  it("settles the bill in full, pays less cash, and books the difference as income", async () => {
    const { sb, marker } = await openE2eSession();
    const admin = serviceClient();
    let billId: string | null = null;
    let paymentId: string | null = null;
    let vendorId: string | null = null;

    try {
      // A vendor on 2/10 net 30 — pay within ten days, keep 2%.
      const { data: vendor, error: vendorError } = await sb
        .from("acc_vendor")
        .insert({
          name: `${marker} Discount Vendor`,
          payment_terms: "2/10 net 30",
          payment_terms_days: 30,
          discount_percent: 2,
          discount_days: 10,
        })
        .select("id")
        .single();
      expect(vendorError, vendorError?.message).toBeNull();
      vendorId = (vendor as { id: string }).id;

      const { data: expenseAccount } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "expense")
        .eq("is_posting_account", true)
        .limit(1)
        .single();
      const { data: bankAccount } = await sb
        .from("acc_bank_account")
        .select("account_id")
        .limit(1)
        .single();

      const { data: bill, error: billError } = await sb
        .from("acc_bill")
        .insert({
          vendor_id: vendorId,
          bill_date: today,
          currency_code: "USD",
          memo: `${marker} discount test`,
        })
        .select("id")
        .single();
      expect(billError, billError?.message).toBeNull();
      billId = (bill as { id: string }).id;

      await sb.from("acc_bill_line").insert({
        bill_id: billId,
        description: `${marker} line`,
        amount_minor: 100_000,
        expense_account_id: (expenseAccount as { id: string }).id,
      });

      const { error: postError } = await sb.rpc("acc_post_bill", { p_bill_id: billId });
      expect(postError, postError?.message).toBeNull();

      // Terms applied at posting: due in 30 days, 2% for the first 10.
      const { data: posted } = await sb
        .from("acc_bill")
        .select("total_minor,balance_due_minor,due_date,discount_due_date,discount_amount_minor,terms_label")
        .eq("id", billId)
        .single();
      const raised = posted as Record<string, unknown>;
      expect(raised.terms_label).toBe("2/10 net 30");
      expect(Number(raised.discount_amount_minor), "2% of 1,000.00").toBe(2_000);
      expect(raised.discount_due_date).not.toBeNull();

      // Pay 980.00 in cash and take the 20.00 discount.
      const { error: payError } = await sb.rpc("acc_pay_bills", {
        p_vendor_id: vendorId,
        p_payment_date: today,
        p_currency: "USD",
        p_amount_minor: 98_000,
        p_payment_account_id: (bankAccount as { account_id: string }).account_id,
        p_method: "ACH",
        p_memo: `${marker} discount payment`,
        p_allocations: [{ bill_id: billId, amount_minor: 98_000, discount_minor: 2_000 }],
      });
      expect(payError, payError?.message).toBeNull();

      const { data: settled } = await sb
        .from("acc_bill")
        .select("status,balance_due_minor,discount_taken_minor")
        .eq("id", billId)
        .single();
      const after = settled as Record<string, unknown>;
      expect(after.status, "the bill is settled in full").toBe("paid");
      expect(Number(after.balance_due_minor)).toBe(0);
      expect(Number(after.discount_taken_minor)).toBe(2_000);

      // The entry: 1,000 off payables, 980 out of the bank, 20 to income.
      const { data: payment } = await sb
        .from("acc_bill_payment")
        .select("id,journal_entry_id")
        .eq("memo", `${marker} discount payment`)
        .single();
      paymentId = (payment as { id: string }).id;

      const { data: lines } = await sb
        .from("acc_journal_line")
        .select("debit_minor,credit_minor,acc_account(account_code,account_type)")
        .eq("journal_entry_id", (payment as { journal_entry_id: string }).journal_entry_id);

      const byType = (type: string) =>
        (lines ?? []).filter(
          (l) => (l.acc_account as unknown as { account_type: string }).account_type === type,
        );
      const payable = byType("accounts_payable")[0] as unknown as { debit_minor: number };
      const bank = byType("bank")[0] as unknown as { credit_minor: number };
      const income = byType("other_income")[0] as unknown as {
        credit_minor: number;
        acc_account: { account_code: string };
      };

      expect(Number(payable.debit_minor), "payables relieved in full").toBe(100_000);
      expect(Number(bank.credit_minor), "cash actually paid").toBe(98_000);
      expect(Number(income.credit_minor), "the discount, as income").toBe(2_000);
      expect(
        (income.acc_account as unknown as { account_code: string }).account_code,
        "posted to Purchase Discounts Taken",
      ).toBe("7010");
    } finally {
      // Unwind in dependency order; numbered documents need the service role.
      if (paymentId) {
        const { data: entry } = await admin
          .from("acc_bill_payment")
          .select("journal_entry_id")
          .eq("id", paymentId)
          .single();
        await admin.from("acc_bill_payment_allocation").delete().eq("bill_payment_id", paymentId);
        await admin.from("acc_bill_payment").delete().eq("id", paymentId);
        if (entry?.journal_entry_id) {
          await admin.from("acc_journal_line").delete().eq("journal_entry_id", entry.journal_entry_id);
          await admin.from("acc_journal_entry").delete().eq("id", entry.journal_entry_id);
        }
      }
      if (billId) {
        const { data: entry } = await admin
          .from("acc_bill")
          .select("journal_entry_id")
          .eq("id", billId)
          .single();
        await admin.from("acc_bill_line").delete().eq("bill_id", billId);
        await admin.from("acc_bill").delete().eq("id", billId);
        if (entry?.journal_entry_id) {
          await admin.from("acc_journal_line").delete().eq("journal_entry_id", entry.journal_entry_id);
          await admin.from("acc_journal_entry").delete().eq("id", entry.journal_entry_id);
        }
      }
      if (vendorId) await admin.from("acc_vendor").delete().eq("id", vendorId);
      await closeE2eSession(sb);
    }
  });

  it("refuses a discount the vendor never offered, and one claimed too late", async () => {
    const { sb } = await openE2eSession();
    try {
      // BILL-000008 is 171 days overdue and carries no discount at all.
      const { data: bill } = await sb
        .from("acc_bill")
        .select("id,vendor_id,currency_code,discount_due_date")
        .eq("status", "open")
        .is("discount_due_date", null)
        .limit(1)
        .maybeSingle();
      if (!bill) return;

      const { data: bankAccount } = await sb
        .from("acc_bank_account")
        .select("account_id")
        .limit(1)
        .single();

      const { error } = await sb.rpc("acc_pay_bills", {
        p_vendor_id: (bill as { vendor_id: string }).vendor_id,
        p_payment_date: today,
        p_currency: (bill as { currency_code: string }).currency_code,
        p_amount_minor: 100,
        p_payment_account_id: (bankAccount as { account_id: string }).account_id,
        p_method: "ACH",
        p_memo: null,
        p_allocations: [{ bill_id: (bill as { id: string }).id, amount_minor: 100, discount_minor: 50 }],
      });

      expect(error, "a discount that was never offered must be refused").not.toBeNull();
      expect(error!.message).toContain("offers no early payment discount");
    } finally {
      await closeE2eSession(sb);
    }
  });
});
