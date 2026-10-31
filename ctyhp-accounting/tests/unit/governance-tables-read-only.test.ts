import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase", "migrations");
const FILE = "0167_governance_tables_read_only.sql";
const strip = (sql: string) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const code = strip(readFileSync(join(DIR, FILE), "utf8"));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

const TABLES = [
  "acc_app_user", "acc_role_permission", "acc_permission", "acc_approval_policy",
  "acc_accounting_period", "acc_period_event", "acc_company_setting_version", "acc_audit_log",
];
/** Read off the live database on 2026-10-26: the one write policy on each table. */
const WRITE_POLICIES: Record<string, string> = {
  acc_app_user: "acc_app_user_admin_write",
  acc_role_permission: "acc_role_permission_write",
  acc_permission: "acc_permission_write",
  acc_approval_policy: "acc_approval_policy_write",
  acc_accounting_period: "acc_period_write",
  acc_period_event: "acc_period_event_ins",
  acc_company_setting_version: "acc_company_setting_ins",
  acc_audit_log: "acc_audit_insert",
};

const body = (fn: string) => {
  const start = code.indexOf(`create or replace function ${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

describe("0167_governance_tables_read_only", () => {
  it("starts with the schema search path, so it runs in every company", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("drops the one write policy on each of the eight tables, and no read policy", () => {
    for (const [table, policy] of Object.entries(WRITE_POLICIES)) {
      expect(code, table).toMatch(new RegExp(`drop policy if exists ${policy} on ${table};`));
    }
    expect(code.match(/drop policy if exists/g)).toHaveLength(8);
    expect(code).not.toMatch(/drop policy if exists \w*(_read|_sel)\b/);
  });

  it("revokes writing on all eight from a session, and keeps reading", () => {
    const listed = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean).sort();
    const revoke = code.match(/revoke insert, update, delete, truncate on([\s\S]*?)from authenticated, anon;/);
    const grant = code.match(/grant select on([\s\S]*?)to authenticated;/);
    expect(listed(revoke![1])).toEqual([...TABLES].sort());
    expect(listed(grant![1])).toEqual([...TABLES].sort());
  });

  it("adds a person only with users.manage, never twice, and only one who exists", () => {
    const add = body("acc_add_company_user");
    expect(add).toMatch(/security definer/);
    expect(add).toMatch(/if not acc_has_permission\('users\.manage'\) then/);
    expect(add).toMatch(/not exists \(select 1 from auth\.users u where u\.id = p_user_id\)/);
    expect(add).toMatch(/This person is already in this company/);

    const existing = body("acc_add_existing_user");
    expect(existing).toMatch(/if not acc_has_permission\('users\.manage'\) then/);
    expect(existing).toMatch(/where lower\(u\.email\) = v_email/);
    expect(existing).toMatch(/No OneBook sign-in uses/);
    expect(existing).toMatch(/already in this company/);
    for (const fn of ["acc_add_company_user(uuid, text, acc_app_role)", "acc_add_existing_user(text, acc_app_role)"]) {
      expect(code, fn).toContain(`revoke all on function ${fn} from public, anon;`);
    }
  });

  it("is not undone: no later migration gives a session a write policy or grant on these tables", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > FILE)) {
      const sql = strip(readFileSync(join(DIR, file), "utf8"));
      for (const m of sql.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(all|insert|update|delete)\b/gi)) {
        expect(TABLES, `${file}: ${m[1]} on ${m[2]}`).not.toContain(m[2]);
      }
      for (const m of sql.matchAll(/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+([^;]+?)\s+to\s+[^;]*authenticated/gi)) {
        for (const table of TABLES) {
          expect(new RegExp(`\\b${table}\\b`).test(m[2]), `${file} grants writing ${table}`).toBe(false);
        }
      }
    }
  });
});

describe("the application side of 2.57", () => {
  it("adds a user through the function, never by writing the users table", () => {
    const access = read("lib", "services", "access.ts");
    expect(access).not.toMatch(/from\("acc_app_user"\)\s*\.(insert|upsert|update|delete)/);
    expect(access).toMatch(/rpc\("acc_add_company_user"/);
    // Since 2.96 an existing account is found as a colleague first (0185); the email lookup by any address is gone.
    expect(access).toMatch(/rpc\("find_colleague"/);
    expect(access).not.toMatch(/acc_add_existing_user/);
  });

  it("offers Add existing account beside Add user", () => {
    const client = read("app", "(app)", "settings", "users", "UsersClient.tsx");
    expect(client).toContain("Add existing account");
    expect(client).toMatch(/addExistingUserAction\(\{ email: v\.email, role: v\.role \}\)/);
  });

  it("restores a backup into a new company only for a platform admin, in the action, the page and the list", () => {
    const action = read("app", "(app)", "settings", "backups", "[id]", "restore", "actions.ts");
    const page = read("app", "(app)", "settings", "backups", "[id]", "restore", "page.tsx");
    const list = read("app", "(app)", "settings", "backups", "page.tsx");
    const gate = action.indexOf("if (!(await isPlatformAdmin()))");
    expect(gate).toBeGreaterThan(-1);
    // Asked before anything is provisioned.
    expect(gate).toBeLessThan(action.indexOf("restoreBackupIntoNewCompany(sb"));
    expect(page).toMatch(/if \(!\(await isPlatformAdmin\(\)\)\)/);
    expect(list).toMatch(/canRestore=\{platformAdmin && /);
  });
});
