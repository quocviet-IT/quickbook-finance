/**
 * 2.56: a company's report and lookup functions answer only its members
 * (migration 0166).
 *
 * The permission review of 26 October 2026 proved the opposite: in a throwaway
 * company, a signed-in user with no place in it — and a member who had been
 * suspended — read its general ledger, transaction list and open items,
 * customer names included, through functions that run with their owner's
 * rights. This holds the fix, in a throwaway company built from this tree
 * inside ONE transaction that is always rolled back:
 *
 *  1. An administrator still gets the figures, the customer's name included.
 *  2. Each of the 26 guarded functions refuses an outsider and a suspended
 *     member with 42501 before doing anything; the administrator is never
 *     refused for membership.
 *  3. The service role, acting for no one, is still answered.
 *  4. acc_apply_vendor_terms can no longer be called through the API.
 *  5. No function that runs with its owner's rights and may be called by a
 *     signed-in user is left without a check on its caller, beyond the six
 *     named below with their reasons.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/report-functions-need-membership.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

/** Guarded by 0166. */
const GUARDED = [
  "acc_account_ref_matches", "acc_active_admin_count", "acc_afda_balance", "acc_afda_evaluation",
  "acc_approval_required", "acc_bank_import_batch_locked_lines", "acc_bank_statement_imports",
  "acc_bank_transaction_postings", "acc_bill_settlements", "acc_control_reconciliation",
  "acc_current_work_policy", "acc_fail_recurring_run", "acc_gl_posting_report", "acc_inventory_account_ids",
  "acc_inventory_policy", "acc_inventory_review", "acc_invoice_settlements", "acc_open_items",
  "acc_payables_priority", "acc_period_close_blockers", "acc_period_close_history", "acc_resolve_account_ref",
  "acc_settlement_lag", "acc_stock_count_default_accounts", "acc_transaction_list", "acc_unresolved_account_refs",
];

/** Owner-rights functions a signed-in user may call with no caller check of their own, and why that is safe. */
const NO_CHECK_NEEDED: Record<string, string> = {
  acc_bank_feed_sync_cut_off: "computes from its arguments only",
  acc_document_storage_path_allowed: "computes from its arguments only",
  acc_feedback_screenshot_path_allowed: "computes from its arguments only",
  acc_document_entity_exists: "answers yes or no for an id the caller already holds",
  acc_delete_bank_transaction_with_void: "writes only through functions that check acc_is_staff() first",
  acc_set_cleared_many: "writes only through acc_set_cleared, which checks acc_is_staff() first",
};

/** Anything a body may call that decides who the caller is. */
const CALLER_CHECK =
  /acc_assert_member\(\)|acc_current_role\(\)|acc_is_staff\(\)|acc_is_admin\(\)|acc_has_permission\(|acc_bank_feed_authorized\(\)|acc_recurring_authorized\(\)|auth\.uid\(\)/i;

/** A harmless value of each argument type, so any function can be called. */
const SAMPLE: Record<string, string> = {
  date: "'2026-12-31'::date",
  uuid: "gen_random_uuid()",
  text: "'x'::text",
  "text[]": "'{}'::text[]",
  "uuid[]": "'{}'::uuid[]",
  integer: "10",
  bigint: "0::bigint",
  boolean: "false",
  "timestamp with time zone": "now()",
  jsonb: "'[]'::jsonb",
};

describe("report and lookup functions", () => {
  it("answer only the company's members", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("report-functions-need-membership: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    /** Runs a call in a savepoint; returns its rows or its error. */
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const rows = (await client.query(sql, params)).rows as Record<string, unknown>[];
        await client.query("release savepoint attempt");
        return { rows, code: null as string | null, message: "" };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        const e = err as { code?: string; message: string };
        return { rows: [] as Record<string, unknown>[], code: e.code ?? "?", message: e.message };
      }
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const [stranger, suspended] = (await q<{ id: string }>("select id from auth.users where id <> $1 order by created_at limit 2", [admin.id])).map((r) => r.id);
      const { schema } = await provisionCompany(
        client,
        { slug: `members_${randomBytes(4).toString("hex")}`, legalName: "Membership check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await q("insert into acc_app_user (id, full_name, role, status) values ($1, 'Suspended Example', 'accountant', 'suspended')", [suspended]);
      const [income] = await q<{ id: string }>("select id from acc_account where account_type = 'income' and is_posting_account and status = 'active' order by account_code limit 1");
      const [customer] = await q<{ id: string }>("insert into acc_customer (name) values ('Example Private Customer') returning id");

      // Every owner-rights function a signed-in user may call, with its argument types.
      const functions = await q<{ name: string; types: string[]; is_trigger: boolean; src: string }>(
        `select p.proname as name, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
                p.prorettype = 'trigger'::regtype as is_trigger, p.prosrc as src
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = $1 and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')`,
        [schema],
      );
      const call = (name: string) => {
        const fn = functions.find((f) => f.name === name);
        if (!fn) throw new Error(`${name} is not callable by a signed-in user`);
        const args = fn.types.map((t) => {
          const v = SAMPLE[t];
          if (!v) throw new Error(`${name}: no sample value for ${t}`);
          return v;
        });
        return `select * from ${name}(${args.join(", ")})`;
      };
      const as = async (userId: string | null, role = "authenticated") => {
        await client.query("reset role");
        await client.query(`set local role ${role}`);
        await client.query("select set_config('request.jwt.claims', $1, true)", [userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role })]);
      };

      // An invoice for a recognisable customer, issued by the administrator.
      await as(admin.id);
      const [{ id: invoiceId }] = await q<{ id: string }>(
        "select acc_create_draft_invoice($1, '2026-09-01', null, 'USD', null, $2::jsonb, null) as id",
        [customer.id, JSON.stringify([{ description: "Example", quantity: 1, unit_price_minor: 123456, income_account_id: income.id, tax_code_id: null, item_id: null }])],
      );
      await q("select acc_issue_invoice($1, null)", [invoiceId]);

      // 1. The administrator still gets the figures.
      const ledger = await attempt("select * from acc_gl_posting_report('2026-01-01', '2026-12-31')");
      expect(ledger.code).toBeNull();
      expect(JSON.stringify(ledger.rows)).toContain("Example Private Customer");
      const open = await attempt("select * from acc_open_items('2026-12-31')");
      expect(JSON.stringify(open.rows)).toContain("Example Private Customer");

      // 2. Every guarded function: outsider and suspended refused first; administrator never for membership.
      for (const name of GUARDED) {
        const sql = call(name);
        await as(admin.id);
        const byAdmin = await attempt(sql);
        expect(byAdmin.message, `${name} as administrator`).not.toMatch(/not a member/);
        for (const [who, id] of [["outsider", stranger], ["suspended", suspended]] as const) {
          await as(id);
          const r = await attempt(sql);
          expect(r.code, `${name} as ${who}`).toBe("42501");
          expect(r.message, `${name} as ${who}`).toMatch(/not a member of this company/);
        }
      }

      // 3. The service role acts for no one and is still answered.
      const serviceMay = (await q<{ ok: boolean }>("select has_function_privilege('service_role', 'acc_gl_posting_report(date, date)', 'execute') as ok"))[0].ok;
      if (serviceMay) {
        await as(null, "service_role");
        const bySystem = await attempt("select * from acc_gl_posting_report('2026-01-01', '2026-12-31')");
        expect(bySystem.code).toBeNull();
        expect(bySystem.rows.length).toBeGreaterThan(0);
      }

      // 4. acc_apply_vendor_terms is for other functions only.
      await as(admin.id);
      const terms = await attempt("select acc_apply_vendor_terms(gen_random_uuid())");
      expect(terms.code).toBe("42501");
      expect(terms.message).toMatch(/permission denied for function/);

      // 5. Nothing else is left without a check on its caller.
      const unchecked = functions
        .filter((f) => !f.is_trigger && !CALLER_CHECK.test(f.src))
        .map((f) => f.name)
        .sort();
      expect(unchecked).toEqual(Object.keys(NO_CHECK_NEEDED).sort());
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
