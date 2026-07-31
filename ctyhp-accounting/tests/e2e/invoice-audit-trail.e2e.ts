import { describe, expect, it } from "vitest";
import { createDraftInvoice, issueInvoice } from "@/lib/services/invoicing";
import { searchAudit } from "@/lib/services/access";
import { diffAuditEntry, documentAttribution } from "@/lib/domain/audit";
import { closeE2eSession, openE2eSession } from "./support/session";
import { sweepMarker } from "./support/cleanup";

const STAMP_COLUMNS = "id,status,created_by,created_at,updated_by,updated_at";

/**
 * The stamps and the audit log are written by the database, so nothing short of
 * a real signed-in write proves they hold. This runs over HTTPS as an
 * administrator against the live schema, then removes everything it created.
 */
describe("invoice audit trail over HTTPS", () => {
  it("stamps the author, refuses to let the stamp be rewritten, and logs every change", async () => {
    const { sb, userId, marker, today } = await openE2eSession();

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
      expect(accountError, "an active income account is required").toBeNull();

      const draft = await createDraftInvoice(sb, {
        customer_id: customer!.id,
        currency_code: "USD",
        issue_date: today,
        due_date: today,
        memo: marker,
        lines: [
          {
            description: "Audit stamp check",
            quantity: 1,
            unit_price_minor: 1000,
            income_account_id: account!.id,
            tax_code_id: null,
            item_id: null,
          },
        ],
      });

      // 1. Creation is attributed to the signed-in user, by the database.
      const created = await readStamps(sb, draft.id);
      expect(created.created_by, "the author must be the signed-in user").toBe(userId);
      expect(created.updated_by).toBe(userId);
      expect(Date.now() - Date.parse(created.created_at)).toBeLessThan(5 * 60 * 1000);

      // 2. The creation stamp is immutable: a direct update that tries to
      //    reassign authorship is accepted as a statement and ignored as a fact.
      const spoofDate = "2000-01-01T00:00:00+00:00";
      const { error: spoofError } = await sb
        .from("acc_invoice")
        .update({ created_by: null, created_at: spoofDate, memo: marker })
        .eq("id", draft.id);
      expect(spoofError).toBeNull();

      const afterSpoof = await readStamps(sb, draft.id);
      expect(afterSpoof.created_by, "created_by must survive an overwrite attempt").toBe(userId);
      expect(afterSpoof.created_at).toBe(created.created_at);
      expect(
        Date.parse(afterSpoof.updated_at),
        "an update must move the modification stamp",
      ).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

      // 3. Issuing posts to the ledger and is recorded as its own action.
      await issueInvoice(sb, draft.id);
      const issued = await readStamps(sb, draft.id);
      expect(issued.status).toBe("issued");
      expect(issued.created_by).toBe(userId);
      expect(issued.updated_by).toBe(userId);

      // 4. Every one of those writes left field-level evidence behind.
      const entries = await searchAudit(sb, {
        table_name: "acc_invoice",
        record_id: draft.id,
        actor_id: null,
        action: null,
        from: null,
        to: null,
        limit: 200,
      });
      const actions = entries.map((entry) => entry.action);
      expect(actions, "insert, update and post must all be logged").toEqual(
        expect.arrayContaining(["insert", "update", "post"]),
      );
      for (const entry of entries) {
        expect(entry.actor_id, "every entry names its actor").toBe(userId);
      }

      const post = entries.find((entry) => entry.action === "post")!;
      const changedFields = diffAuditEntry(post).map((change) => change.field);
      expect(changedFields).toContain("status");
      expect(changedFields).toContain("invoice_number");

      // 5. What the invoice screen shows comes from those same stamps.
      const attribution = documentAttribution(issued, new Map([[userId, "e2e-user"]]));
      expect(attribution.createdBy).toBe("e2e-user");
      expect(attribution.modifiedBy).toBe("e2e-user");
    } finally {
      await sweepMarker(sb, marker);
      await closeE2eSession(sb);
    }
  });
});

async function readStamps(
  sb: Awaited<ReturnType<typeof openE2eSession>>["sb"],
  invoiceId: string,
): Promise<{
  status: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}> {
  const { data, error } = await sb
    .from("acc_invoice")
    .select(STAMP_COLUMNS)
    .eq("id", invoiceId)
    .single();
  if (error) throw new Error(`reading invoice stamps failed: ${error.message}`);
  return data as unknown as {
    status: string;
    created_by: string | null;
    created_at: string;
    updated_by: string | null;
    updated_at: string;
  };
}
