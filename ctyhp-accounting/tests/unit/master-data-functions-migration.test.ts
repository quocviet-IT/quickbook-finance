import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { minRoleNote, roleMeets } from "@/lib/domain/access";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0170_master_data_functions.sql"), "utf8").replace(
  /\r\n/g,
  "\n",
);
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");

/** The body of one function, from its `create or replace` to its closing `$$;`. */
function body(name: string): string {
  const start = code.search(new RegExp(`create or replace function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is not defined`);
  return code.slice(start, code.indexOf("$$;", code.indexOf("$$", start) + 2) + 3);
}

/** Every column a save function lists for acc_write_master: the names in its array[...] literals. */
function columns(name: string): string[] {
  return [...body(name).matchAll(/array\[([^\]]*)\]/g)].flatMap((list) =>
    [...list[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]),
  );
}

/** The guard each save function must keep: the same one its table's write policy had. */
const GUARDS: Record<string, RegExp> = {
  acc_save_account: /if not acc_is_staff\(\) then/,
  acc_classify_accounts: /if not acc_is_staff\(\) then/,
  acc_save_bank_account: /if not acc_is_staff\(\) then/,
  acc_save_bank_rule: /if not acc_is_staff\(\) then/,
  acc_delete_bank_rule: /if not acc_is_staff\(\) then/,
  acc_save_banking_preference: /if not acc_is_staff\(\) then/,
  acc_save_related_company: /if not acc_is_staff\(\) then/,
  acc_delete_related_company: /if not acc_is_staff\(\) then/,
  acc_save_repayment_account: /if not acc_is_staff\(\) then/,
  acc_delete_repayment_account: /if not acc_is_staff\(\) then/,
  acc_save_customer: /if not acc_is_staff\(\) then/,
  acc_save_vendor: /if not acc_is_staff\(\) then/,
  acc_save_item: /if not acc_has_permission\('items\.manage'\) then/,
  acc_save_tax_code: /if not acc_is_admin\(\) then/,
  acc_save_recurring_template: /if not acc_has_permission\('recurring\.manage'\) then/,
  acc_set_recurring_template_status: /if not acc_has_permission\('recurring\.manage'\) then/,
};

/** Columns no save may write: the row's identity, its history and its stamps. */
const SYSTEM = ["id", "created_at", "updated_at", "approved_by", "singleton", "last_run_at", "last_run_status", "last_error"];

describe("0170_master_data_functions", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("guards every save with what the table's write policy asked for, before anything else", () => {
    for (const [name, guard] of Object.entries(GUARDS)) {
      const text = body(name);
      expect(text, name).toMatch(/security definer set search_path = public/);
      expect(text, name).toMatch(guard);
      const firstStatement = text.slice(text.indexOf("begin")).split("\n")[1];
      expect(firstStatement, `${name} checks its caller first`).toMatch(/if not acc_(is_staff|is_admin|has_permission)/);
    }
  });

  it("opens each save to signed-in users and to no one else, and closes the shared writer entirely", () => {
    for (const name of Object.keys(GUARDS)) {
      expect(code, name).toMatch(new RegExp(`revoke all on function ${name}\\([^)]*\\) from public, anon;`));
      expect(code, name).toMatch(new RegExp(`grant execute on function ${name}\\([^)]*\\) to authenticated;`));
    }
    expect(code).toMatch(/revoke all on function acc_write_master\(text, uuid, jsonb, text\[\]\) from public, anon, authenticated;/);
    expect(code).not.toMatch(/grant execute on function acc_write_master/);
  });

  it("lets no save write a system column", () => {
    for (const name of Object.keys(GUARDS)) {
      const listed = columns(name);
      for (const column of SYSTEM) expect(listed, `${name} lists ${column}`).not.toContain(column);
    }
  });

  it("fixes an account's code and a customer's currency once they are set", () => {
    const account = body("acc_save_account");
    expect(account).toMatch(/case when p_id is null then array\['account_code'\] else array\[\]::text\[\] end/);
    const customer = body("acc_save_customer");
    expect(customer).toMatch(/case when p_id is null then array\['currency_code'\] else array\[\]::text\[\] end/);
  });

  it("stamps a schedule's author itself, and leaves its status and runs to their own paths", () => {
    const save = body("acc_save_recurring_template");
    expect(save).toMatch(/- 'created_by' - 'updated_by'\)\s*\|\| jsonb_build_object\('created_by', auth\.uid\(\), 'updated_by', auth\.uid\(\)\)/);
    expect(columns("acc_save_recurring_template")).not.toContain("status");
    const status = body("acc_set_recurring_template_status");
    expect(status).toMatch(/if p_status not in \('active', 'paused'\) then/);
    expect(status).toMatch(/if v_status = 'ended' then\s+raise exception 'An ended schedule cannot be resumed';/);
  });

  it("numbers a new bank rule itself and never moves one on an edit", () => {
    const rule = body("acc_save_bank_rule");
    expect(rule).toMatch(/if p_id is null then\s+v_values := v_values \|\| jsonb_build_object\(\s*'position', coalesce\(\(select max\(position\) from acc_bank_rule\), 0\) \+ 1\);/);
  });

  it("writes only the keys it is given, names columns through format('%I'), and reports a missing row as P0002", () => {
    const writer = body("acc_write_master");
    expect(writer).toMatch(/where not \(k = any \(p_allowed\)\)/);
    expect(writer).toMatch(/raise exception 'These fields cannot be saved here: %', v_bad using errcode = '42501';/);
    expect(writer).toMatch(/string_agg\(format\('%I', k\), ', ' order by k\)/);
    expect(writer).toMatch(/raise exception 'This record is no longer here' using errcode = 'P0002';/);
    expect(writer).not.toMatch(/\|\| p_values|\|\| v_values::text/);
  });

  it("records who can use each permission, clears grants that never worked, and refuses new ones", () => {
    expect(code).toMatch(/add column min_role text not null default 'any' check \(min_role in \('any', 'staff', 'admin'\)\)/);
    expect(code).toMatch(/update acc_permission set min_role = 'admin'\s+where key in \('period\.reopen', 'reconciliation\.reopen'\);/);
    const staff = code.match(/update acc_permission set min_role = 'staff'\s+where key in \(([^)]*)\);/)![1];
    expect([...staff.matchAll(/'([a-z_.0-9]+)'/g)].map((m) => m[1]).sort()).toEqual(
      [
        "bill.post", "bill.void", "credit.override", "inventory.adjust", "invoice.issue", "invoice.void",
        "journal.void", "period.close", "po.approve", "po.variance_approve", "reconciliation.complete", "writeoff.create",
      ].sort(),
    );
    expect(code).toMatch(/where p\.key = rp\.permission_key and rp\.allowed and not acc_role_meets\(rp\.role, p\.min_role\);/);
    expect(body("acc_set_role_permission")).toMatch(/if p_allowed and not acc_role_meets\(p_role, v_permission\.min_role\) then/);
  });
});

describe("roleMeets", () => {
  it("matches acc_role_meets: admin above accountant above everyone", () => {
    expect(roleMeets("admin", "admin")).toBe(true);
    expect(roleMeets("accountant", "admin")).toBe(false);
    expect(roleMeets("accountant", "staff")).toBe(true);
    expect(roleMeets("sales", "staff")).toBe(false);
    expect(roleMeets("viewer", "staff")).toBe(false);
    expect(roleMeets("viewer", "any")).toBe(true);
  });

  it("says why a switch is greyed out, and nothing when it is not", () => {
    expect(minRoleNote("admin")).toBe("Only admins can use this");
    expect(minRoleNote("staff")).toBe("Only admins and accountants can use this");
    expect(minRoleNote("any")).toBeNull();
  });
});
