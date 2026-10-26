import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, formatPostalAddress } from "@/lib/domain/invoice-document";
import { getInvoiceDocumentSource, updateCustomer } from "@/lib/services/invoicing";
import { closeE2eSession, createE2eServiceClient, openE2eSession } from "./support/session";

describe("printable invoice over HTTPS", () => {
  it("builds a document for a real issued invoice that agrees with the ledger", async () => {
    const { sb } = await openE2eSession();

    try {
      const { data: invoice, error } = await sb
        .from("acc_invoice")
        .select("id, invoice_number, total_minor, balance_due_minor")
        .eq("status", "issued")
        .order("issue_date", { ascending: false })
        .limit(1)
        .single();
      expect(error, "an issued invoice is required to test printing").toBeNull();

      const source = await getInvoiceDocumentSource(sb, invoice!.id);
      const doc = buildInvoiceDocument(source);

      expect(doc.title).toBe(`Invoice ${invoice!.invoice_number}`);
      expect(doc.watermark, "an issued invoice carries no watermark").toBeNull();
      expect(doc.lines.length, "every invoice must print at least one line").toBeGreaterThan(0);
      expect(doc.lines.length).toBe(source.lines.length);
      expect(doc.billTo.name).toBe(source.customer.name);
      expect(doc.seller.displayName.length).toBeGreaterThan(0);

      // The printed balance is the ledger's balance, formatted — not recomputed.
      const balanceRow = doc.totals.at(-1)!;
      expect(balanceRow.label).toBe("Balance due");
      const printedMinor = Math.round(
        Number(balanceRow.amount.replace(/[^0-9.-]/g, "")) * 100,
      );
      expect(printedMinor).toBe(invoice!.balance_due_minor);

      // A customer-facing page has no business carrying the seller's EIN.
      const ein = source.company.ein_ref;
      if (ein) expect(JSON.stringify(doc)).not.toContain(ein);
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("stores and reads back a customer billing address", async () => {
    const { sb, marker } = await openE2eSession();

    try {
      const { data: created, error: createError } = await sb.rpc("acc_save_customer", {
        p_id: null,
        p_values: { name: marker, currency_code: "USD" },
      });
      expect(createError).toBeNull();

      const updated = await updateCustomer(sb, {
        id: created!.id,
        name: marker,
        email: "billing@example.com",
        contact_name: "Test Contact",
        phone: "+1 617 555 0100",
        address_line1: "9 Charles Street",
        address_line2: null,
        city: "Cambridge",
        region: "MA",
        postal_code: "02138",
        country: "United States",
        credit_hold: false,
      });

      expect(formatPostalAddress(updated)).toEqual([
        "9 Charles Street",
        "Cambridge, MA 02138",
        "United States",
      ]);

      // Master-data writes are audited atomically by the 0058 trigger.
      const { count } = await sb
        .from("acc_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("table_name", "acc_customer")
        .eq("record_id", created!.id)
        .eq("action", "update");
      expect(count, "the address change must be audited").toBeGreaterThan(0);

      // No screen deletes a customer; since 2.60 the probe is the service role's to remove.
      const { error: deleteError } = await createE2eServiceClient()
        .from("acc_customer")
        .delete()
        .eq("id", created!.id);
      expect(deleteError).toBeNull();
    } finally {
      await closeE2eSession(sb);
    }
  });
});
