import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3.0.25, item A of the defect report of 11 Nov 2026: a line coded in Bank
 * Transactions can be moved to another account inside a reconciled month,
 * by a second entry the same day, and Change still refuses to void it there.
 * What it does on real books is proved by scripts/verify-recode-any-line.mjs;
 * this holds the migration's shape and the screen's wiring.
 */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase", "migrations", "0194_recode_any_bank_line.sql");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");

function body(source: string, name: string): string {
  const start = source.search(new RegExp(`create or replace function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is not defined`);
  return source.slice(start, source.indexOf("\n$$;", source.indexOf("as $$", start)) + 4);
}

describe("0194_recode_any_bank_line", () => {
  const recode = body(code, "acc_recode_bank_transaction");

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("checks its caller first", () => {
    expect(recode).toMatch(/security definer set search_path = public/);
    expect(recode.slice(recode.indexOf("begin")).split("\n")[1]).toMatch(/if not acc_is_staff\(\) then/);
  });

  it("never touches the bank side: it posts a second entry tied to the line's own, and voids only a recode", () => {
    expect(recode).toContain("'bank', v_entry.id, v_entry.currency_code,");
    expect(recode).toContain("update acc_journal_entry set status = 'void', voided_at = now() where id = v_recode.id;");
    expect(recode).not.toMatch(/update acc_journal_entry set status = 'void'[^;]*v_entry\.id/);
    expect(recode).not.toMatch(/acc_reconciliation_line|delete from acc_reconciliation|update acc_bank_transaction/);
  });

  it("refuses what it cannot do, each in its own words", () => {
    for (const words of [
      "This line came from a transactions import, which owns its entry.",
      "This line is not coded",
      "so it is not recoded here.",
      "This line is posted to more than one account, so it is not recoded here.",
      "it is not an active posting account",
      "A bank account is not a category",
      "This line is already posted to %",
    ]) {
      expect(recode, words).toContain(words);
    }
  });

  it("keeps the account before and after in the audit log", () => {
    expect(recode).toContain("'recode', auth.uid(),");
    expect(recode).toMatch(/jsonb_build_object\('account_id', v_current,/);
    expect(recode).toMatch(/jsonb_build_object\('account_id', v_target\.id,/);
  });

  it("reads where a recode moved the money as the recode's line off the line's own account", () => {
    const recodes = body(code, "acc_bank_recodes");
    expect(recodes).toContain("join acc_journal_line rl on rl.journal_entry_id = re.id and rl.account_id <> ol.account_id");
    expect(recodes).not.toContain("uncategorized");
    expect(recodes).toMatch(/language sql stable security invoker/);
  });

  it("keeps Change refusing a reconciled line, naming Recode, its body otherwise 0177's", () => {
    const original = body(read("supabase", "migrations", "0177_not_the_same_thing.sql"), "acc_uncategorise_bank_transaction").split("\n");
    const copy = body(sql, "acc_uncategorise_bank_transaction").split("\n");
    const changed = copy.filter((line) => !original.includes(line));
    expect(changed.length).toBe(3);
    for (const line of changed) {
      expect(line).toContain(
        "so its entry is not voided: its date, amount and bank account stay as reconciled. To move it to another account, use Recode, which posts the change beside it.",
      );
    }
    expect(original.filter((line) => !copy.includes(line)).length).toBe(3);
  });

  it("opens every function to signed-in users and the service role only", () => {
    for (const signature of ["acc_recode_bank_transaction(uuid, uuid)", "acc_bank_recodes(uuid)", "acc_uncategorise_bank_transaction(uuid, text)"]) {
      const escaped = signature.replace(/[()[\]]/g, "\\$&");
      expect(code, signature).toMatch(new RegExp(`revoke all on function ${escaped} from public, anon;`));
      expect(code, signature).toMatch(new RegExp(`grant execute on function ${escaped}\\s+to authenticated, service_role;`));
    }
  });
});

describe("Recode on Bank Transactions", () => {
  const cell = read("app", "(app)", "banking", "CategoriseCell.tsx");
  const recoded = read("app", "(app)", "banking", "RecodedCategory.tsx");

  it("is offered on any line coded here to one account, not only Uncategorized", () => {
    expect(cell).toContain("const mayRecode = mayChange && others.length === 0;");
    expect(cell).toContain("{mayRecode ? (");
    expect(cell).not.toContain("{mayChange && holding ? (");
    expect(cell).toContain("recodeBankTransactionAction(transactionId, accountId)");
  });

  it("never offers the account the line is on already, a bank account or Uncategorized", () => {
    expect(cell).toContain('!holdingIds.has(option.value) && option.type !== "bank" && option.value !== posting?.account_id');
  });

  it("says where a recoded line's money came from", () => {
    expect(recoded).toContain("Recoded from {from}");
    expect(cell).toContain("from={`${posting.account_code} — ${posting.account_name}`}");
  });
});
