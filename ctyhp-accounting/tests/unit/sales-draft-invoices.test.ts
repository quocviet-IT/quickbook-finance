import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0173_sales_draft_invoices.sql";
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
const raw = read("supabase", "migrations", FILE);
const code = raw.replace(/--[^\n]*/g, "");
const fn = code.slice(code.indexOf("create or replace function acc_create_draft_invoice"), code.indexOf("revoke all on function acc_create_draft_invoice"));

describe("0173_sales_draft_invoices", () => {
  it("starts with the schema search path, qualifies nothing with public., and runs in every company", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
    expect(code).not.toMatch(/onebook\./);
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    expect(plan.statements.some((s) => /acc_create_draft_invoice/.test(s))).toBe(true);
  });

  it("adds Create draft invoices, enforced, for admin, accountant and sales but not viewer", () => {
    expect(code).toMatch(/\('invoice\.create', 'Create draft invoices', 'Sales',/);
    expect(code).toMatch(/true, 'any'\)\s+on conflict \(key\) do update/);
    expect(code).toMatch(
      /select role, 'invoice\.create', role in \('admin'::acc_app_role, 'accountant'::acc_app_role, 'sales'::acc_app_role\)/,
    );
    // A company that switches it off keeps that if the migration runs again.
    expect(code).toMatch(/'invoice\.create'[\s\S]*?on conflict \(role, permission_key\) do nothing;/);
  });

  it("makes a draft need invoice.create instead of the admin-or-accountant role, keeping the recurring runner's way in", () => {
    expect(fn).toMatch(
      /if not acc_has_permission\('invoice\.create'\)\s+and not \(auth\.role\(\) = 'service_role' and p_recurring_run_id is not null\) then\s+raise exception 'You do not have permission to create invoices';/,
    );
    expect(fn).not.toMatch(/acc_is_staff/);
    expect(fn).toMatch(/language plpgsql security definer set search_path = public as/);
    // Amounts are still worked out here, never taken from the caller.
    expect(fn).toMatch(/v_line_sub := round\(v_quantity \* v_unit_price\)::bigint;/);
    expect(code).toMatch(/revoke all on function acc_create_draft_invoice\(uuid, date, date, text, text, jsonb, uuid\) from public;/);
  });

  it("gives sales documents.read only where no person set the cell, and writes the change to the audit log", () => {
    expect(code).toMatch(
      /where role = 'sales' and permission_key = 'documents\.read' and not allowed and updated_by is null\s+returning role/,
    );
    expect(code).toMatch(/insert into acc_audit_log \(table_name, record_id, action, actor_id, after_json\)\s+select 'acc_role_permission', null, 'update', null,/);
  });
});

describe("the Invoices screen", () => {
  const page = read("app", "(app)", "invoices", "page.tsx");
  const client = read("app", "(app)", "invoices", "InvoicesClient.tsx");
  const actions = read("app", "(app)", "invoices", "actions.ts");

  it("offers New invoice to whoever holds invoice.create, and keeps customers and estimates with admins and accountants", () => {
    expect(page).toMatch(/holdsPermission\("invoice\.create"\)/);
    expect(page).toMatch(/canCreate=\{holdsCreate\}/);
    expect(page).toMatch(/\(params\.estimate \? fromEstimate\.prefill !== null : holdsCreate\)/);
    expect(client).toMatch(/canCreate \? \(\s+<Button type="primary" icon=\{<PlusOutlined \/>\} onClick=\{openCreate\}>/);
    expect(client).toMatch(/\{canWrite \? \(\s+<Form\.Item label=" ">\s+<Button onClick=\{\(\) => setCustOpen\(true\)\}/);
  });

  it("checks invoice.create on the server for a draft, and the role for one made from an estimate", () => {
    expect(actions).toMatch(
      /const denied = estimateId\s+\? await guard\(\)\s+: \(await holdsPermission\("invoice\.create"\)\)\s+\? null\s+: "You do not have permission to create invoices";/,
    );
    // Issuing and voiding are unchanged.
    expect(actions).toMatch(/export async function issueInvoiceAction[\s\S]*?const denied = await guard\(\);/);
    expect(actions).toMatch(/export async function voidInvoiceAction[\s\S]*?const denied = await guard\(\);/);
  });
});
