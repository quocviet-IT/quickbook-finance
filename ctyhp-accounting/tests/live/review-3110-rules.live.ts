/**
 * 2.94: the rules migration 0183 adds, run for real.
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. The rules that are global (the storage
 * path checks and the question count) are built from 0183's own statements in
 * a scratch schema inside the same transaction, so the live ones are never
 * touched.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/review-3110-rules.live.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { scopeOf, splitSqlStatements } from "@/lib/domain/schema-template";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("0183 in the database", () => {
  it("files feedback only from members, keeps two permissions with admins, and counts questions", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("review-3110-rules: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const rows = (await client.query(sql, params)).rows;
        await client.query("release savepoint attempt");
        return { error: null as string | null, rows };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, rows: [] as Record<string, unknown>[] };
      }
    };
    const as = async (userId: string, aal: "aal1" | "aal2" = "aal1") => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal })]);
    };
    const owner = () => client.query("reset role");
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      // A dropped connection must not leave this transaction holding anything.
      await client.query("set local idle_in_transaction_session_timeout = '60s'");

      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const others = await q<{ id: string }>(
        "select id from auth.users where id <> $1 and email is not null order by created_at limit 3",
        [admin.id],
      );
      expect(others).toHaveLength(3);
      const [viewer, outsider, accountant] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `rules_${randomBytes(4).toString("hex")}`, legalName: "Rules check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        "insert into acc_app_user (id, full_name, role, status) values ($1, 'Viewer', 'viewer', 'active'), ($2, 'Accountant', 'accountant', 'active')",
        [viewer.id, accountant.id],
      );
      for (const id of [admin.id, viewer.id, accountant.id]) {
        expect((await q<{ n: number }>("select count(*)::int as n from auth.mfa_factors where user_id = $1 and status = 'verified'", [id]))[0].n, "starts with no factor").toBe(0);
      }

      // The global statements of 0183, built in a scratch schema.
      const scratch = `review_${randomBytes(4).toString("hex")}`;
      await client.query(`create schema ${scratch}`);
      await client.query(`grant usage on schema ${scratch} to authenticated`);
      const migration = readFileSync(join(process.cwd(), "supabase/migrations/0183_review_3110_rules.sql"), "utf8");
      const global = splitSqlStatements(migration)
        .filter((s) => scopeOf(s).scope === "global" && !/^\s*(--[^\n]*\n\s*)*notify\b/i.test(s))
        .map((s) =>
          s
            .replace(/onebook\.ai_request/g, `${scratch}.ai_request`)
            .replace(/onebook\.take_ai_turn/g, `${scratch}.take_ai_turn`)
            .replace(/create or replace function acc_feedback_(screenshot|attachment)_path_allowed/g, `create or replace function ${scratch}.acc_feedback_$1_path_allowed`),
        );
      expect(global.length).toBeGreaterThanOrEqual(8);
      for (const statement of global) {
        expect(statement, "a global statement still names the live register's writes").not.toMatch(/onebook\.(ai_request|take_ai_turn)/);
        await client.query(statement);
      }
      await client.query(`grant execute on function ${scratch}.acc_feedback_screenshot_path_allowed(text), ${scratch}.acc_feedback_attachment_path_allowed(text) to authenticated`);

      // 1. Feedback.
      const report = (extra: Record<string, unknown> = {}) => {
        const row = { kind: "broken", page_url: "https://example.test/banking", page_route: "/banking", viewport_width: 1280, viewport_height: 720, ...extra };
        const cols = Object.keys(row);
        return attempt(
          `insert into acc_feedback_report (${cols.join(", ")}, reporter_id) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, auth.uid()) returning id`,
          Object.values(row),
        );
      };
      await as(outsider.id);
      expect((await report()).error, "someone with no role here files nothing").toMatch(/row-level security/);
      await as(viewer.id);
      expect((await report({ triage_note: "Already handled" })).error, "a new report is untriaged").toMatch(/row-level security/);
      expect((await report({ screenshot_path: `${randomUUID()}/${randomUUID()}.png` })).error, "and has no screenshot yet").toMatch(/row-level security/);
      expect((await report({ page_url: `https://example.test/${"a".repeat(2100)}` })).error, "a page address has a length").toMatch(/row-level security/);
      const filed = await report();
      expect(filed.error).toBeNull();
      const reportId = String(filed.rows[0].id);

      const attach = (path: string) =>
        attempt(
          "insert into acc_feedback_attachment (report_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'note.pdf', 'application/pdf', 100, auth.uid())",
          [reportId, path],
        );
      expect((await attach(`${randomUUID()}/${randomUUID()}.pdf`)).error, "a row names a file in its own report's folder").toMatch(/row-level security/);
      expect((await attach(`${reportId}/${randomUUID()}.pdf`)).error).toBeNull();
      await as(accountant.id);
      expect((await attach(`${reportId}/${randomUUID()}.pdf`)).error, "only the reporter attaches").toMatch(/row-level security/);

      const shot = `${reportId}/${randomUUID()}.png`;
      const file = `${reportId}/${randomUUID()}.pdf`;
      const allowed = async (fn: "screenshot" | "attachment", path: string) =>
        (await attempt(`select ${scratch}.acc_feedback_${fn}_path_allowed($1) as ok`, [path])).rows[0]?.ok;
      await as(viewer.id);
      expect(await allowed("screenshot", shot), "the reporter may add the screenshot").toBe(true);
      expect(await allowed("attachment", file), "and attachments").toBe(true);
      await as(accountant.id);
      expect(await allowed("screenshot", shot), "a colleague may not").toBe(false);
      expect(await allowed("attachment", file)).toBe(false);
      await as(outsider.id);
      expect(await allowed("screenshot", shot), "nor may an outsider").toBe(false);
      await owner();
      await client.query(`update ${schema}.acc_feedback_report set screenshot_path = $1 where id = $2`, [shot, reportId]);
      await as(viewer.id);
      expect(await allowed("screenshot", `${reportId}/${randomUUID()}.png`), "a report keeps the screenshot it has").toBe(false);

      // 2. Manage users and Manage permissions.
      await owner();
      expect(
        await q<{ key: string; min_role: string }>("select key, min_role from acc_permission where key in ('users.manage', 'permissions.manage') order by key"),
      ).toEqual([
        { key: "permissions.manage", min_role: "admin" },
        { key: "users.manage", min_role: "admin" },
      ]);
      expect(
        (await q<{ n: number }>("select count(*)::int as n from acc_role_permission where permission_key in ('users.manage', 'permissions.manage') and allowed and role <> 'admin'"))[0].n,
      ).toBe(0);
      await as(admin.id);
      expect((await attempt("select acc_set_role_permission('accountant', 'users.manage', true)")).error).toMatch(/cannot be given to the accountant role/);
      expect((await attempt("select acc_set_role_permission('viewer', 'permissions.manage', true)")).error).toMatch(/cannot be given to the viewer role/);
      expect((await attempt("select acc_set_role_permission('accountant', 'invoice.create', true)")).error, "an ordinary permission still moves").toBeNull();

      // 3. Retiring finished work.
      await owner();
      await client.query(
        "insert into acc_work_item_state (work_key, lifecycle, dismiss_reason) values ('review3110:a', 'dismissed', 'Handled elsewhere'), ('review3110:b', 'in_progress', null)",
      );
      const open = async () =>
        (await q<{ n: number }>("select count(*)::int as n from acc_work_item_state where work_key like 'review3110:%' and lifecycle <> 'resolved'"))[0].n;
      await as(outsider.id);
      expect((await attempt("select acc_retire_work_items(array[]::text[], array['review3110:'])")).error).toMatch(/Not authorized/);
      await as(viewer.id);
      expect((await attempt("select acc_retire_work_items(array[]::text[], array['review3110:']) as n")).rows[0].n, "a viewer's visit retires nothing").toBe(0);
      await owner();
      expect(await open()).toBe(2);
      await as(accountant.id);
      expect((await attempt("select acc_retire_work_items(array['review3110:b'], array['review3110:']) as n")).rows[0].n, "staff tidy what has gone").toBe(1);
      await owner();
      expect(await open()).toBe(1);

      // 4. Two-step entries in the audit log.
      const addFactor = (userId: string) =>
        client.query(
          `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
           values (gen_random_uuid(), $1, $2, 'totp', 'verified', now(), now(), 'live-test')`,
          [userId, `live test ${randomBytes(3).toString("hex")}`],
        );
      const dropFactors = (userId: string) => client.query("delete from auth.mfa_factors where user_id = $1", [userId]);

      await owner();
      await addFactor(accountant.id);
      await as(accountant.id, "aal2");
      expect((await attempt("select acc_record_two_step_off(1)")).error, "not while the factor is there").toMatch(/still on/);
      await owner();
      await dropFactors(accountant.id);
      await as(accountant.id);
      expect((await attempt("select acc_record_two_step_off(99)")).error).toBeNull();

      await owner();
      await addFactor(accountant.id);
      await as(admin.id);
      expect((await attempt("select acc_record_mfa_reset($1, 'Lost their phone', 1)", [accountant.id])).error, "not while the factor is there").toMatch(/still has two-step/);
      await owner();
      await dropFactors(accountant.id);
      await as(admin.id);
      expect((await attempt("select acc_record_mfa_reset($1, 'Lost their phone', 1)", [accountant.id])).error).toBeNull();

      await owner();
      const entries = await q<{ action: string; after_json: Record<string, unknown> }>(
        "select action, after_json from acc_audit_log where table_name = 'acc_app_user' and record_id = $1 and action in ('mfa_off', 'mfa_reset') order by action",
        [accountant.id],
      );
      expect(entries).toEqual([
        { action: "mfa_off", after_json: { factors_removed: 10 } },
        { action: "mfa_reset", after_json: { reason: "Lost their phone", factors_removed: 1 } },
      ]);

      // 5. Questions to the model.
      await as(viewer.id);
      const turns: boolean[] = [];
      for (let i = 0; i < 61; i++) turns.push(Boolean((await attempt(`select ${scratch}.take_ai_turn() as ok`)).rows[0]?.ok));
      expect(turns.slice(0, 60).every(Boolean), "sixty in an hour").toBe(true);
      expect(turns[60], "and not the sixty-first").toBe(false);
      await as(outsider.id);
      expect((await attempt(`select ${scratch}.take_ai_turn() as ok`)).rows[0].ok, "counted per person").toBe(true);
      expect((await attempt(`select count(*) from ${scratch}.ai_request`)).error, "nobody reads or clears the count").toMatch(/permission denied/);
      await owner();
      await client.query(`update ${scratch}.ai_request set asked_at = now() - interval '61 minutes' where user_id = $1`, [viewer.id]);
      await as(viewer.id);
      expect((await attempt(`select ${scratch}.take_ai_turn() as ok`)).rows[0].ok, "an hour later the count has gone").toBe(true);
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
