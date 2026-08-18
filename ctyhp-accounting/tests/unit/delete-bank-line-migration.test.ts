import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

/**
 * RQ-06 asks that "if deletion fails, the data must remain unchanged".
 *
 * The first shipped version could not promise that: the server action made two
 * separate RPC calls — void the categorising entry, then delete the line — so a
 * refusal on the second left the entry voided and the line alive. This
 * migration closes that window by moving the composition into one function,
 * which is one transaction, so a refusal anywhere rolls the whole thing back.
 *
 * These assertions are about *shape*, not behaviour: they hold the design
 * decisions a later edit could quietly undo — that the function composes rather
 * than re-implements, and that it never grows its own copy of a rule the two
 * functions behind it already enforce.
 */
const file = "0114_delete_bank_transaction_with_void.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
const fn = sql.slice(sql.indexOf("function acc_delete_bank_transaction_with_void"));

describe("atomic bank line delete migration", () => {
  it("takes the same two arguments the screen already sends", () => {
    expect(fn).toMatch(/acc_delete_bank_transaction_with_void\(\s*p_id\s+uuid,\s*p_reason\s+text\s*\)/i);
    expect(fn).toMatch(/language plpgsql security definer set search_path = public/i);
  });

  it("composes the two audited functions instead of re-implementing them", () => {
    // Fails the moment someone inlines the void or the delete. Both composed
    // functions write their own audit row and enforce their own refusals; a
    // hand-rolled copy here would be a second place those rules live.
    expect(fn).toMatch(/perform acc_uncategorise_bank_transaction\(/i);
    expect(fn).toMatch(/perform acc_delete_bank_transaction\(/i);
    expect(fn).not.toMatch(/update acc_journal_entry/i);
    expect(fn).not.toMatch(/delete from acc_bank_transaction/i);
    expect(fn).not.toMatch(/delete from acc_reconciliation/i);
    expect(fn).not.toMatch(/insert into acc_audit_log/i);
  });

  it("only reaches for the void when the line actually carries an entry", () => {
    // An unmatched line has nothing to void, and acc_uncategorise would refuse
    // it with "This line is not categorised" — a message about the wrong thing.
    expect(fn).toMatch(/status\s*=\s*'matched'/i);
  });

  it("names the settlement refusal itself, because neither composed function can", () => {
    // A line settled against an invoice or bill carries an approved
    // reconciliation with no journal_line_id. acc_uncategorise only knows the
    // entries it made, so it would answer "not categorised" — which reads as if
    // nothing had ever happened to this line. It has.
    expect(fn).toMatch(/journal_line_id is null/i);
    expect(fn).toMatch(/settled against an invoice or bill/i);
  });

  it("locks the row for the whole transaction before touching it", () => {
    // The concurrent edit between void and delete was the entire failure this
    // migration exists to remove; the lock is what stops it recurring inside
    // the single transaction too.
    expect(fn).toMatch(/from acc_bank_transaction[\s\S]{0,60}for update/i);
  });

  it("does not re-check authorization or the reason", () => {
    // Both composed functions demand acc_is_staff(), and the delete demands a
    // ten-character reason. Repeating either here would be a second copy of a
    // rule that must have exactly one — and a copy that can drift.
    expect(fn).not.toContain("acc_is_staff()");
    expect(fn).not.toMatch(/length\(btrim/i);
  });

  it("is reachable by a signed-in user and no one else", () => {
    expect(sql).toMatch(
      /revoke all on function acc_delete_bank_transaction_with_void\(uuid, text\) from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function acc_delete_bank_transaction_with_void\(uuid, text\)[\s\S]{0,40}to authenticated, service_role/i,
    );
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
