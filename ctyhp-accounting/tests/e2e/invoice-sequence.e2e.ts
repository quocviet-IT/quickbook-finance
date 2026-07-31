import { describe, expect, it } from "vitest";
import { createDraftInvoice, issueInvoice } from "@/lib/services/invoicing";
import { listSequenceCatalog, listSequenceDocuments } from "@/lib/services/sequence";
import { auditSequence } from "@/lib/domain/sequence";
import { closeE2eSession, openE2eSession } from "./support/session";
import { sweepMarker } from "./support/cleanup";

/**
 * The numbering controls live in the database, so only a real signed-in write
 * proves them. Everything created here is removed again by the sweep, which
 * documents the number it frees.
 */
describe("invoice numbering integrity over HTTPS", () => {
  it("refuses to let a client set, change, or delete an invoice number", async () => {
    const { sb, marker, today } = await openE2eSession();

    try {
      await sweepMarker(sb, marker);

      const { data: customer, error: customerError } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD" })
        .select("id")
        .single();
      expect(customerError).toBeNull();

      const { data: account, error: accountError } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "income")
        .eq("is_posting_account", true)
        .eq("status", "active")
        .limit(1)
        .single();
      expect(accountError).toBeNull();

      const draft = await createDraftInvoice(sb, {
        customer_id: customer!.id,
        currency_code: "USD",
        issue_date: today,
        due_date: today,
        memo: marker,
        lines: [
          {
            description: "Numbering guard check",
            quantity: 1,
            unit_price_minor: 1000,
            income_account_id: account!.id,
            tax_code_id: null,
            item_id: null,
          },
        ],
      });

      // 1. A draft has no number, and a client cannot give it one.
      const { error: assignError } = await sb
        .from("acc_invoice")
        .update({ invoice_number: "INV-999999" })
        .eq("id", draft.id);
      expect(assignError, "assigning a number by hand must be refused").not.toBeNull();
      expect(assignError!.message).toMatch(/assigned by the system/i);

      // 2. Issuing takes the next number from the sequence.
      await issueInvoice(sb, draft.id);
      const { data: issued } = await sb
        .from("acc_invoice")
        .select("invoice_number")
        .eq("id", draft.id)
        .single();
      const number = (issued as { invoice_number: string }).invoice_number;
      expect(number).toMatch(/^INV-\d{6}$/);

      // 3. That number is now write-once.
      const { error: rewriteError } = await sb
        .from("acc_invoice")
        .update({ invoice_number: "INV-000001" })
        .eq("id", draft.id);
      expect(rewriteError, "rewriting a number must be refused").not.toBeNull();

      // 4. And the numbered document cannot be removed from the application.
      const { error: deleteError } = await sb.from("acc_invoice").delete().eq("id", draft.id);
      expect(deleteError, "deleting a numbered invoice must be refused").not.toBeNull();
      expect(deleteError!.message).toMatch(/cannot be deleted/i);

      const { data: stillThere } = await sb
        .from("acc_invoice")
        .select("id")
        .eq("id", draft.id)
        .maybeSingle();
      expect(stillThere, "the refused delete must not have removed anything").not.toBeNull();

      // 5. The live sequence reads back with the new number in place and no
      //    fresh break of its own.
      const catalog = await listSequenceCatalog(sb);
      const definition = catalog.find((row) => row.sequence_key === "invoice")!;
      const documents = await listSequenceDocuments(sb, "invoice");
      const audit = auditSequence({ definition, documents });

      const issuedValue = Number(number.replace(/\D/g, ""));
      expect(audit.rows[issuedValue - 1].state).toBe("present");
      expect(audit.summary.beyondSequence).toBe(0);
      expect(audit.summary.allocated).toBeGreaterThanOrEqual(issuedValue);
    } finally {
      await sweepMarker(sb, marker);
      await closeE2eSession(sb);
    }
  });

  it("leaves a documented reason behind for the number its cleanup frees", async () => {
    const { sb, marker, today } = await openE2eSession();

    try {
      const { data: customer } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD" })
        .select("id")
        .single();
      const { data: account } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "income")
        .eq("is_posting_account", true)
        .eq("status", "active")
        .limit(1)
        .single();

      const draft = await createDraftInvoice(sb, {
        customer_id: (customer as { id: string }).id,
        currency_code: "USD",
        issue_date: today,
        due_date: today,
        memo: marker,
        lines: [
          {
            description: "Gap note check",
            quantity: 1,
            unit_price_minor: 500,
            income_account_id: (account as { id: string }).id,
            tax_code_id: null,
            item_id: null,
          },
        ],
      });
      await issueInvoice(sb, draft.id);
      const { data: issued } = await sb
        .from("acc_invoice")
        .select("invoice_number")
        .eq("id", draft.id)
        .single();
      const freed = Number(
        (issued as { invoice_number: string }).invoice_number.replace(/\D/g, ""),
      );

      await sweepMarker(sb, marker);

      const { data: note } = await sb
        .from("acc_number_gap_note")
        .select("reason")
        .eq("sequence_key", "invoice")
        .eq("number_value", freed)
        .single();
      expect((note as { reason: string }).reason).toContain(marker);

      // With the note in place the gap is explained, not an open exception.
      const catalog = await listSequenceCatalog(sb);
      const definition = catalog.find((row) => row.sequence_key === "invoice")!;
      const [documents, notes] = await Promise.all([
        listSequenceDocuments(sb, "invoice"),
        sb
          .from("acc_number_gap_note")
          .select("number_value, reason, noted_at")
          .eq("sequence_key", "invoice")
          .then((res) => (res.data ?? []) as { number_value: number; reason: string; noted_at: string }[]),
      ]);
      const audit = auditSequence({ definition, documents, notes });
      expect(audit.rows[freed - 1].state).toBe("missing");
      expect(audit.rows[freed - 1].note?.reason).toContain(marker);
    } finally {
      await sweepMarker(sb, marker);
      await closeE2eSession(sb);
    }
  });
});
