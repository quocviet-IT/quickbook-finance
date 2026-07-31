import { describe, expect, it } from "vitest";
import { closeE2eSession, openE2eSession } from "./support/session";

/**
 * The rule the reviewer asked for is only real if the database holds it: a
 * bank account is a statement feed, and physical cash has no statement. This
 * proves the refusal on the live schema, and that the seeded chart now says
 * which account is which.
 */
describe("bank account ledger classification over HTTPS", () => {
  it("refuses to attach a bank account to cash on hand", async () => {
    const { sb, marker } = await openE2eSession();

    try {
      const { data: cash } = await sb
        .from("acc_account")
        .select("id, name, detail_type")
        .eq("account_type", "bank")
        .eq("detail_type", "cash_on_hand")
        .limit(1)
        .maybeSingle();
      expect(cash, "the seeded chart must classify its cash-on-hand account").toBeTruthy();

      const attempt = await sb.from("acc_bank_account").insert({
        account_id: (cash as { id: string }).id,
        bank_name: marker,
        currency_code: "USD",
      });
      expect(attempt.error, "cash on hand must not accept a bank account").not.toBeNull();
      expect(attempt.error!.message).toMatch(/physical cash/i);

      // And nothing was created by the refused attempt.
      const { data: created } = await sb
        .from("acc_bank_account")
        .select("id")
        .eq("bank_name", marker);
      expect(created ?? []).toHaveLength(0);
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("refuses a ledger account that is not a bank account at all", async () => {
    const { sb, marker } = await openE2eSession();

    try {
      const { data: expense } = await sb
        .from("acc_account")
        .select("id")
        .eq("account_type", "expense")
        .eq("is_posting_account", true)
        .limit(1)
        .single();

      const attempt = await sb.from("acc_bank_account").insert({
        account_id: (expense as { id: string }).id,
        bank_name: marker,
        currency_code: "USD",
      });
      expect(attempt.error).not.toBeNull();
      expect(attempt.error!.message).toMatch(/Bank-type ledger account/i);
    } finally {
      await closeE2eSession(sb);
    }
  });
});
