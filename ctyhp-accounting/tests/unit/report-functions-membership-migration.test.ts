import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const FILE = "0166_report_functions_need_membership.sql";
const read = (file: string) => readFileSync(join(DIR, file), "utf8").replace(/\r\n/g, "\n");
const sql = read(FILE);
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");
const norm = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

const GUARDED = [
  "acc_account_ref_matches", "acc_active_admin_count", "acc_afda_balance", "acc_afda_evaluation",
  "acc_approval_required", "acc_bank_import_batch_locked_lines", "acc_bank_statement_imports",
  "acc_bank_transaction_postings", "acc_bill_settlements", "acc_control_reconciliation",
  "acc_current_work_policy", "acc_fail_recurring_run", "acc_gl_posting_report", "acc_inventory_account_ids",
  "acc_inventory_policy", "acc_inventory_review", "acc_invoice_settlements", "acc_open_items",
  "acc_payables_priority", "acc_period_close_blockers", "acc_period_close_history", "acc_resolve_account_ref",
  "acc_settlement_lag", "acc_stock_count_default_accounts", "acc_transaction_list", "acc_unresolved_account_refs",
];

/** Every `create or replace function` in a migration text: name, whole statement, body. */
function definitions(text: string): { name: string; statement: string; body: string }[] {
  const out: { name: string; statement: string; body: string }[] = [];
  const opener = /create\s+or\s+replace\s+function\s+(acc_\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text))) {
    const tag = /\bas\s+(\$[a-z_]*\$)/gi;
    tag.lastIndex = m.index;
    const t = tag.exec(text);
    if (!t) continue;
    const bodyStart = t.index + t[0].length;
    const close = text.indexOf(t[1], bodyStart);
    const end = text.indexOf(";", close) + 1;
    out.push({ name: m[1], statement: text.slice(m.index, end), body: text.slice(bodyStart, close) });
  }
  return out;
}

/** The last definition of a function in the migrations before 0166. */
function previous(name: string): string {
  let last: string | null = null;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < FILE).sort()) {
    for (const d of definitions(read(file).replace(/^\s*--[^\n]*$/gm, ""))) if (d.name === name) last = d.body;
  }
  if (last === null) throw new Error(`${name} has no earlier definition`);
  return last;
}

const defs = definitions(code);

describe("0166_report_functions_need_membership", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("refuses with 42501 unless the caller is a member, the service role, or a direct database session", () => {
    const helper = defs.find((d) => d.name === "acc_assert_member")!;
    expect(helper.statement).toMatch(/returns void\s+language plpgsql stable set search_path = public/);
    expect(helper.statement).not.toMatch(/security definer/);
    expect(helper.body).toMatch(/if acc_current_role\(\) is not null then\s+return;/);
    expect(helper.body).toMatch(/current_setting\('role', true\), ''\), 'none'\) in \('none', 'service_role'\)/);
    expect(helper.body).toMatch(/using errcode = '42501'/);
    expect(code).toMatch(/revoke all on function acc_assert_member\(\) from public, anon, authenticated;/);
  });

  it("takes acc_apply_vendor_terms away from the API; other functions still call it as its owner", () => {
    expect(code).toMatch(/revoke execute on function acc_apply_vendor_terms\(uuid\) from public, anon, authenticated;/);
  });

  it("closes the bank feed's skip check in `public` too, where default privileges had granted it", () => {
    expect(code).toMatch(/revoke execute on function acc_bank_feed_try_skip\(uuid, uuid, uuid, date, jsonb\) from authenticated;/);
  });

  it("guards exactly the 26 functions, each once, with the check as its first statement", () => {
    expect(defs.filter((d) => d.name !== "acc_assert_member").map((d) => d.name).sort()).toEqual([...GUARDED].sort());
    for (const d of defs.filter((x) => x.name !== "acc_assert_member")) {
      expect(d.statement, d.name).toMatch(/security definer/);
      const firstSql = /^\s*select acc_assert_member\(\);/.test(d.body);
      const firstPlpgsql = /^\s*(declare[\s\S]*?)?\n\s*begin\s*\n\s*perform acc_assert_member\(\);/i.test(d.body);
      expect(firstSql || firstPlpgsql, d.name).toBe(true);
    }
  });

  it("changes nothing else in any of them", () => {
    for (const d of defs.filter((x) => x.name !== "acc_assert_member")) {
      const without = d.body.replace(/\n {2}select acc_assert_member\(\);/, "").replace(/\n {2}perform acc_assert_member\(\);/, "");
      expect(norm(without), d.name).toBe(norm(previous(d.name)));
    }
  });
});

describe("functions added after 0166", () => {
  const CALLER_CHECK =
    /acc_assert_member\(\)|acc_current_role\(\)|acc_is_staff\(\)|acc_is_admin\(\)|acc_has_permission\(|acc_bank_feed_authorized\(\)|acc_recurring_authorized\(\)|auth\.uid\(\)/i;

  it("check their caller whenever they run with their owner's rights", () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > FILE).sort();
    for (const file of later) {
      const text = read(file).replace(/--[^\n]*/g, "");
      for (const d of definitions(text)) {
        if (!/security\s+definer/i.test(d.statement) || /returns\s+trigger/i.test(d.statement)) continue;
        // A function nobody may call from the API is called only by other functions.
        const closed = new RegExp(`revoke (all|execute) on function ${d.name}\\([^)]*\\) from [^;]*authenticated`, "i").test(text);
        if (closed) continue;
        expect(CALLER_CHECK.test(d.body), `${file}: ${d.name} runs with its owner's rights and never checks its caller`).toBe(true);
      }
    }
  });
});
