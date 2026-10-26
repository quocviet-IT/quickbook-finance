import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const FILE = "0169_permissions_enforced.sql";
const read = (file: string) => readFileSync(join(DIR, file), "utf8").replace(/\r\n/g, "\n");
const sql = read(FILE);
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");
const norm = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

const may = (key: string, what: string, indent = "  ") =>
  `${indent}if not acc_has_permission('${key}') then\n` +
  `${indent}  raise exception 'You do not have permission to ${what}';\n` +
  `${indent}end if;\n`;
const staff = (what: string) => `  if not acc_is_staff() then raise exception 'Not authorized to ${what}'; end if;\n`;

/** For each function: what 0169 wrote, and what stood there before. Nothing else may differ. */
const CHANGES: Record<string, [string, string][]> = {
  acc_issue_invoice: [[staff("issue invoices") + may("invoice.issue", "issue invoices"), staff("issue invoices")]],
  acc_void_invoice: [[staff("void invoices") + may("invoice.void", "void invoices"), staff("void invoices")]],
  acc_post_bill: [[staff("post bills") + may("bill.post", "post bills"), staff("post bills")]],
  acc_void_bill: [[staff("void bills") + may("bill.void", "void bills"), staff("void bills")]],
  acc_reverse_entry: [[staff("reverse entries") + may("journal.void", "reverse journal entries"), staff("reverse entries")]],
  acc_complete_reconciliation: [
    [
      "  if not acc_is_staff() then raise exception 'Not authorized'; end if;\n" + may("reconciliation.complete", "complete reconciliations"),
      "  if not acc_is_staff() then raise exception 'Not authorized'; end if;\n",
    ],
  ],
  acc_bring_history_forward: [
    [
      "  if not acc_is_staff() then\n    raise exception 'Not authorized to bring a bank account forward';\n  end if;\n" +
        may("reconciliation.complete", "complete reconciliations"),
      "  if not acc_is_staff() then\n    raise exception 'Not authorized to bring a bank account forward';\n  end if;\n",
    ],
  ],
  acc_close_period: [
    [
      staff("close a period") + may("period.close", "close a period"),
      "  if not acc_is_admin() then raise exception 'Only an admin can close a period'; end if;\n",
    ],
  ],
  acc_approve_purchase_order: [
    [staff("approve purchase orders") + may("po.approve", "approve purchase orders"), staff("approve purchase orders")],
  ],
  acc_create_bill_from_po: [
    [
      "      if not acc_has_permission('po.variance_approve') then\n" +
        "        raise exception 'This bill is outside the purchase order''s matching tolerance, and you do not have permission to approve match variances';\n" +
        "      end if;\n" +
        "      if v_reason = '' then\n",
      "      if v_reason = '' then\n",
    ],
  ],
  acc_save_company_settings: [
    [
      may("settings.manage", "change company settings"),
      "  if not acc_is_admin() then raise exception 'Only an admin can change company settings'; end if;\n",
    ],
  ],
  acc_save_work_policy: [
    [
      may("settings.manage", "change the work policy"),
      "  if not acc_is_admin() then\n    raise exception 'Only an admin can change the work policy';\n  end if;\n",
    ],
  ],
  acc_set_purchasing_config: [
    [
      may("settings.manage", "change purchasing tolerances"),
      "  if not acc_is_admin() then raise exception 'Only an admin can change purchasing tolerances'; end if;\n",
    ],
  ],
  acc_generate_periods: [
    [
      may("settings.manage", "set up accounting periods"),
      "  if not acc_is_admin() then raise exception 'Only an admin can generate periods'; end if;\n",
    ],
  ],
};

const NINE = [
  "invoice.issue", "invoice.void", "bill.post", "bill.void", "journal.void",
  "reconciliation.complete", "period.close", "po.approve", "po.variance_approve",
];

/** Every `create or replace function` in a migration text: name and body. */
function definitions(text: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const opener = /create\s+or\s+replace\s+function\s+(acc_\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text))) {
    const tag = /\bas\s+(\$[a-z_]*\$)/gi;
    tag.lastIndex = m.index;
    const t = tag.exec(text);
    if (!t) continue;
    const bodyStart = t.index + t[0].length;
    out.push({ name: m[1], body: text.slice(bodyStart, text.indexOf(t[1], bodyStart)) });
  }
  return out;
}

let earlier: Map<string, string> | null = null;
/** The last definition of a function in the migrations before 0169, read once. */
function previous(name: string): string {
  if (!earlier) {
    earlier = new Map();
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < FILE).sort()) {
      for (const d of definitions(read(file).replace(/^\s*--[^\n]*$/gm, ""))) earlier.set(d.name, d.body);
    }
  }
  const last = earlier.get(name);
  if (last === undefined) throw new Error(`${name} has no earlier definition`);
  return last;
}

const defs = definitions(sql);

describe("0169_permissions_enforced", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("redefines exactly the fourteen functions, each once", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(CHANGES).sort());
  });

  it("changes each only where it says: the permission check, and nothing else", () => {
    for (const d of defs) {
      let before = d.body;
      for (const [now, was] of CHANGES[d.name]) {
        expect(before.includes(now), `${d.name} lacks its new check`).toBe(true);
        before = before.split(now).join(was);
      }
      expect(norm(before), d.name).toBe(norm(previous(d.name)));
    }
  });

  it("checks po.variance_approve before each of the two variances it accepts", () => {
    const bill = defs.find((d) => d.name === "acc_create_bill_from_po")!;
    expect(bill.body.split("acc_has_permission('po.variance_approve')").length - 1).toBe(2);
  });

  it("marks the nine enforced, and takes period.close away from accountants", () => {
    for (const key of NINE) {
      expect(code, key).toMatch(new RegExp(`update acc_permission set is_enforced = true,[^;]*\\n where key = '${key.replace(".", "\\.")}';`));
    }
    expect(code).toMatch(
      /update acc_role_permission\s+set allowed = false, updated_at = now\(\)\s+where role = 'accountant' and permission_key = 'period\.close' and allowed;/,
    );
    // No other cell of the matrix moves.
    expect(code.match(/update acc_role_permission/g)).toHaveLength(1);
  });

  it("revokes each write that no policy allows, per kind of write, and TRUNCATE everywhere", () => {
    expect(code).toMatch(/foreach w in array array\['INSERT', 'UPDATE', 'DELETE'\] loop/);
    expect(code).toMatch(/and p\.cmd in \(w, 'ALL'\)\)/);
    expect(code).toMatch(/execute format\('revoke %s on %I from authenticated, anon', w, t\.relname\);/);
    // Both names of the schema are retargeted to each company's own.
    expect(code).toMatch(/where n\.nspname = 'public'/);
    expect(code).toMatch(/where p\.schemaname = 'public'/);
    expect(code).toMatch(/revoke truncate on all tables in schema public from authenticated, anon;/);
    // It only ever takes away.
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create policy/i);
  });
});

describe("permissions added after 0169", () => {
  it("are seeded enforced: the screen no longer has a place for one that is not", () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > FILE).sort();
    for (const file of later) {
      const text = read(file).replace(/--[^\n]*/g, "");
      for (const m of text.matchAll(/insert\s+into\s+acc_permission\s*\(([^)]*)\)([\s\S]*?);/gi)) {
        expect(m[1], `${file} seeds a permission without saying whether it is enforced`).toMatch(/is_enforced/);
        expect(m[2], `${file} seeds a permission that is not enforced`).not.toMatch(/\bfalse\b/i);
      }
    }
  });
});
