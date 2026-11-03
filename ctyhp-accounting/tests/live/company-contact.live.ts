/**
 * 2.99: the company's phone and email, kept in its settings, and cash basis
 * refused (migration 0186).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. The settings are saved by OneBook's own
 * service, then by a call that predates 0186, as the code still running when
 * the migration lands sends it.
 *
 *  1. Saved with a phone and an email: the new version carries both, trimmed.
 *  2. Saved by a caller that sends neither: both are kept, and so is how to pay.
 *  3. Saved with both empty: they are cleared.
 *  4. An email that is not one, a phone over 40 characters, cash basis and a
 *     save by a viewer are refused.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/company-contact.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { getCurrentCompanySettings, saveCompanySettings } from "@/lib/services/company";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("the company's phone and email in its settings", () => {
  it("are kept with each version, kept by a caller that does not send them, and cleared when emptied", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("company-contact: hard timeout");
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
        { slug: `contact_${randomBytes(4).toString("hex")}`, legalName: "Contact check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
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

      // 1. Saved with a phone and an email.
      await saveCompanySettings(sb, { ...base, pay_note: "Checks payable to Example Jewelry LLC.", phone: "  (213) 555-0100 ", email: " billing@example.com " });
      const saved = await getCurrentCompanySettings(sb);
      expect([saved?.phone, saved?.email]).toEqual(["(213) 555-0100", "billing@example.com"]);

      // 2. A caller from before 0186 sends neither: both are kept, and how to pay with them.
      await client.query(
        `select acc_save_company_settings(p_legal_name => 'Example Jewelry LLC', p_dba_name => null, p_ein_ref => null,
           p_address_line1 => null, p_address_line2 => null, p_city => null, p_region => null, p_postal_code => null,
           p_country => null, p_fiscal_year_start_month => 1, p_base_currency_code => 'USD',
           p_time_zone => 'America/Los_Angeles', p_accounting_basis => 'accrual', p_default_payment_terms_days => 45,
           p_inventory_valuation_method => null, p_inventory_policy_memo => null, p_pay_note => null)`,
      );
      const kept = await getCurrentCompanySettings(sb);
      expect([kept?.version, kept?.default_payment_terms_days, kept?.phone, kept?.email, kept?.pay_note]).toEqual([
        (saved?.version ?? 0) + 1,
        45,
        "(213) 555-0100",
        "billing@example.com",
        "Checks payable to Example Jewelry LLC.",
      ]);

      // 3. Emptied: cleared.
      await saveCompanySettings(sb, { ...base, phone: "", email: "" });
      const cleared = await getCurrentCompanySettings(sb);
      expect([cleared?.phone, cleared?.email]).toEqual([null, null]);

      // 4. Refusals.
      const save =
        "select acc_save_company_settings('Example Jewelry LLC', null, null, null, null, null, null, null, null, 1, 'USD', 'America/Los_Angeles', $1, 30, null, null, null, $2, $3)";
      expect(await attempt(save, ["accrual", "billing at example", null])).toMatch(/email_shape/);
      expect(await attempt(save, ["accrual", null, "5".repeat(41)])).toMatch(/phone_len/);
      expect(await attempt(save, ["cash", null, null])).toMatch(/cash basis is not implemented/);
      await as(viewer.id);
      expect(await attempt(save, ["accrual", "billing@example.com", null])).toMatch(/permission to change company settings/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
