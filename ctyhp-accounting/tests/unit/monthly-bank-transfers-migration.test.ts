import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

// Comments stripped as migration-grants.test.ts does (CRLF-safe, block comments
// too), so a sentence in a comment can never satisfy an assertion.
function stripComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const FILE = "0199_monthly_bank_transfers.sql";
const raw = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const flat = stripComments(raw).replace(/\s+/g, " ").toLowerCase();
const SIGNATURE = "acc_monthly_bank_transfers(date, int)";

/** The function's body, between its dollar quotes. */
const body = (() => {
  const match = /as \$\$([\s\S]*?)\$\$;/i.exec(stripComments(raw));
  return (match?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
})();

describe("0199 monthly bank transfers", () => {
  it("returns one row per month: the month's key and the amount moved between the company's own bank accounts", () => {
    expect(flat).toContain(
      "create or replace function acc_monthly_bank_transfers(p_to date, p_months int) returns table ( month_key text, transfer_base bigint )",
    );
    expect(body).not.toBe("");
  });

  it("is a read under the caller's own rights: stable, security invoker, never security definer", () => {
    expect(flat).toContain("language sql stable security invoker as $$");
    expect(flat).not.toContain("security definer");
  });

  it("reads the window acc_monthly_ledger_balances reads: posted entries, posting accounts, on or before p_to, p_months back", () => {
    expect(body).toContain(
      "select (date_trunc('month', p_to) - make_interval(months => greatest(coalesce(p_months, 12), 1) - 1))::date as from_date",
    );
    expect(body).toContain("where e.status = 'posted'");
    expect(body).toContain("and a.is_posting_account");
    expect(body).toContain("and e.entry_date <= p_to");
    expect(body).toContain("and e.entry_date >= (select from_date from window_start)");
  });

  it("sums each posted entry's bank-type debits and credits, and counts the smaller as moved between banks", () => {
    expect(body).toContain("and a.account_type = 'bank'");
    expect(body).toContain("coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else 0 end), 0) as bank_debit");
    expect(body).toContain("coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0) as bank_credit");
    // Per entry, not per month: two entries that each touch one bank are not a transfer.
    expect(body).toContain("group by e.id, e.entry_date");
    expect(body).toContain("sum(least(bank_debit, bank_credit))::bigint");
  });

  it("keys a month by the entry date and leaves out a month with nothing moved", () => {
    expect(body).toContain("to_char(entry_date, 'yyyy-mm')");
    expect(body).toContain("group by to_char(entry_date, 'yyyy-mm') having sum(least(bank_debit, bank_credit)) > 0 order by 1");
  });

  it("is executable when signed in and by the service role, by nobody else", () => {
    expect(flat).toContain(`revoke all on function ${SIGNATURE} from public, anon;`);
    expect(flat).toContain(`grant execute on function ${SIGNATURE} to authenticated, service_role;`);
    const grants = flat.match(/grant [^;]+;/g) ?? [];
    expect(grants).toEqual([`grant execute on function ${SIGNATURE} to authenticated, service_role;`]);
  });

  it("writes nothing", () => {
    expect(body).not.toMatch(/\b(insert|update|delete|truncate)\b/);
    expect(flat).not.toMatch(/\b(create|alter|drop) table\b/);
  });

  it("is built into every company's schema: nothing in it is held back as global", () => {
    // migrate.mjs replays a migration into each company schema, and a new company is built the same way.
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    expect(plan.skipped).toEqual([]);
    const statements = plan.statements.map((s) => stripComments(s).replace(/\s+/g, " ").trim().toLowerCase());
    expect(statements[0]).toBe("set search_path = co_probe");
    expect(statements[1]).toMatch(/^create or replace function acc_monthly_bank_transfers\(p_to date, p_months int\)/);
    expect(statements.slice(2)).toEqual([
      `revoke all on function ${SIGNATURE} from public, anon`,
      `grant execute on function ${SIGNATURE} to authenticated, service_role`,
    ]);
  });
});
