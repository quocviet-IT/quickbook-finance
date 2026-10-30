/**
 * 2.83: how to pay, kept in the company's settings (migration 0179).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. The settings are saved by OneBook's own
 * service, then by a call that predates the note, as the code still running
 * when 0179 lands sends it.
 *
 *  1. Saved with a note: the new version carries it, trimmed.
 *  2. Saved by a caller that sends no note: the note is kept.
 *  3. Saved with an empty note: it is cleared.
 *  4. A note over 600 characters is refused, and so is a save by a viewer.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/invoice-pay-note.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { getCurrentCompanySettings, saveCompanySettings } from "@/lib/services/company";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("how to pay in the company's settings", () => {
  it("is kept with each version, kept by a caller that does not send it, and cleared when emptied", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("invoice-pay-note: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        await client.query(sql, params);
        await client.query("release savepoint attempt");
        return null;
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return (err as Error).message;
      }
    };
    const as = async (userId: string) => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const [viewer] = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 1", [admin.id]);
      const { schema } = await provisionCompany(
        client,
        { slug: `paynote_${randomBytes(4).toString("hex")}`, legalName: "Pay note check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query("insert into acc_app_user (id, full_name, role, status) values ($1, 'Example Viewer', 'viewer', 'active')", [viewer.id]);
      await as(admin.id);
      const sb = pgSupabase(client);
      const base = {
        legal_name: "Example Jewelry LLC",
        fiscal_year_start_month: 1,
        base_currency_code: "USD" as const,
        time_zone: "America/Los_Angeles",
        accounting_basis: "accrual" as const,
        default_payment_terms_days: 30,
      };

      // 1. Saved with a note.
      await saveCompanySettings(sb, { ...base, pay_note: "  Checks payable to Example Jewelry LLC.  " });
      expect((await getCurrentCompanySettings(sb))?.pay_note).toBe("Checks payable to Example Jewelry LLC.");

      // 2. A caller from before 0179 sends no note: it is kept on the new version.
      const before = (await getCurrentCompanySettings(sb))?.version;
      await client.query(
        `select acc_save_company_settings(p_legal_name => 'Example Jewelry LLC', p_dba_name => null, p_ein_ref => null,
           p_address_line1 => null, p_address_line2 => null, p_city => null, p_region => null, p_postal_code => null,
           p_country => null, p_fiscal_year_start_month => 1, p_base_currency_code => 'USD',
           p_time_zone => 'America/Los_Angeles', p_accounting_basis => 'accrual', p_default_payment_terms_days => 45)`,
      );
      const kept = await getCurrentCompanySettings(sb);
      expect([kept?.version, kept?.default_payment_terms_days, kept?.pay_note]).toEqual([(before ?? 0) + 1, 45, "Checks payable to Example Jewelry LLC."]);

      // 3. Emptied: cleared.
      await saveCompanySettings(sb, { ...base, pay_note: "" });
      expect((await getCurrentCompanySettings(sb))?.pay_note).toBeNull();

      // 4. Refusals.
      const save = "select acc_save_company_settings('Example Jewelry LLC', null, null, null, null, null, null, null, null, 1, 'USD', 'America/Los_Angeles', 'accrual', 30, null, null, $1)";
      expect(await attempt(save, ["x".repeat(601)])).toMatch(/pay_note_len/);
      await as(viewer.id);
      expect(await attempt(save, ["Wire only"])).toMatch(/permission to change company settings/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
