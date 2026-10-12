import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, \r already gone. */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** The text of one `create or replace function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

const raw = read("0140_remove_balance_entries.sql");
const sql = strip(raw);
const blockers = functionText(sql, "acc_balance_entry_blockers");
const remove = functionText(sql, "acc_remove_balance_entries");

describe("0140 remove balance entries: shape", () => {
  it("creates exactly the two functions", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["acc_balance_entry_blockers", "acc_remove_balance_entries"]);
  });

  it.each([
    ["acc_balance_entry_blockers", blockers],
    ["acc_remove_balance_entries", remove],
  ])("%s is security definer with a fixed search_path", (_name, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("is idempotent: functions are created or replaced, nothing else is created", () => {
    expect(sql).not.toMatch(/create (table|type|index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
  });

  it("returns the documented shapes", () => {
    expect(blockers).toMatch(/returns table \(entry_id uuid, entry_number text, reason text\)/i);
    expect(remove).toMatch(/returns jsonb/i);
    expect(remove).toMatch(
      /jsonb_build_object\('removed', v_count, 'reversed', v_reversed,\s*'voided', v_voided, 'total_minor', v_total\)/i,
    );
  });

  it("the blockers function is read-only", () => {
    expect(blockers.slice(0, blockers.indexOf("$$"))).toMatch(/\bstable\b/i);
    expect(blockers).not.toMatch(/\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("0140 grants", () => {
  it.each([
    "acc_balance_entry_blockers\\(uuid\\[\\]\\)",
    "acc_remove_balance_entries\\(uuid, uuid\\[\\], text\\)",
  ])("%s: revoked from public and anon, executable by signed-in users and the service role", (sig) => {
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon`, "i"));
    expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role`, "i"));
  });
});

describe("0140 who may call", () => {
  it("both functions require staff", () => {
    for (const text of [blockers, remove]) expect(text).toMatch(/if not acc_is_staff\(\) then\s+raise exception/i);
  });

  it("removing needs the journal-posting permission, checked after staff", () => {
    expect(remove).toMatch(/if not acc_has_permission\('journal\.post'\) then\s+raise exception/i);
    expect(remove.indexOf("acc_has_permission('journal.post')")).toBeGreaterThan(remove.indexOf("acc_is_staff()"));
  });

  it("the permission is checked before anything is read or written", () => {
    expect(remove.indexOf("acc_has_permission('journal.post')")).toBeLessThan(remove.indexOf("for update"));
  });
});

describe("0140 refusals of the request itself", () => {
  it("requires a reason, a non-empty list, distinct ids and a real bank account", () => {
    expect(remove).toMatch(/v_reason\s+text := btrim\(coalesce\(p_reason, ''\)\)/i);
    expect(remove).toMatch(/if v_reason = '' then\s+raise exception/i);
    expect(remove).toMatch(/cardinality\(p_entry_ids\) = 0/i);
    expect(remove).toMatch(/names the same entry more than once/i);
    expect(remove).toMatch(/Bank account not found/i);
  });

  it("an entry with no line on the bank account's ledger account is refused", () => {
    expect(remove).toMatch(/from acc_bank_account b join acc_account a on a\.id = b\.account_id/i);
    expect(remove).toMatch(/not exists \(select 1 from acc_journal_line l\s+where l\.journal_entry_id = e\.id and l\.account_id = v_ledger\)/i);
    expect(remove).toMatch(/have no line on %/i);
  });

  it("locks the entries in id order before deciding anything", () => {
    expect(remove).toMatch(/where id = any \(p_entry_ids\) order by id for update/i);
    expect(remove.indexOf("for update")).toBeLessThan(remove.indexOf("acc_balance_entry_blockers(p_entry_ids)"));
  });

  it("one exception lists every blocked entry, and it comes before any change", () => {
    expect(remove).toMatch(/acc_balance_entry_blockers\(p_entry_ids\)/i);
    expect(remove).toMatch(/raise exception '% of these entries cannot be removed: %', v_blocked, v_list/i);
    const refusal = remove.indexOf("cannot be removed: %");
    for (const change of ["acc_post_entry(", "update acc_journal_entry set", "delete from acc_bank_transaction", "insert into acc_audit_log"]) {
      expect(remove.indexOf(change), change).toBeGreaterThan(refusal);
    }
  });
});

describe("0140 every blocker reason", () => {
  it("an unknown id", () => {
    expect(blockers).toMatch(/found_id is null then\s+'is not in the books'/i);
    expect(blockers).toMatch(/left join acc_journal_entry e on e\.id = i\.id/i);
  });

  it("not posted, already reversed, itself a reversal", () => {
    expect(blockers).toMatch(/f\.status <> 'posted' then\s+'is not posted/i);
    expect(blockers).toMatch(/original_entry_id = e\.id\) as is_reversed/i);
    expect(blockers).toMatch(/f\.is_reversed then\s+'has already been reversed'/i);
    expect(blockers).toMatch(/reversal_entry_id = e\.id\) as is_reversal/i);
    expect(blockers).toMatch(/itself a reversal/i);
  });

  it("a line ticked in a COMPLETED reconciliation names the statement date", () => {
    expect(blockers).toMatch(/sr\.status = 'completed'/i);
    expect(blockers).toMatch(/join acc_reconciliation_line rl|from acc_reconciliation_line rl/i);
    expect(blockers).toMatch(/is ticked in the reconciliation for the statement dated/i);
    expect(blockers).toMatch(/to_char\(f\.signed_on, 'Mon FMDD, YYYY'\)/i);
  });

  it("a closed period", () => {
    expect(blockers).toMatch(/acc_is_period_closed\(e\.entry_date\) as is_closed/i);
    expect(blockers).toMatch(/in a closed period/i);
  });

  it("a document-owned entry names the kind, the number when cheap, and what to void", () => {
    expect(blockers).toMatch(/f\.source_type not in \('manual', 'opening_balance', 'bank'\)/i);
    expect(blockers).toMatch(/'belongs to '/i);
    expect(blockers).toMatch(/coalesce\(' ' \|\| f\.doc_number, ''\)/i);
    expect(blockers).toMatch(/'; void the '/i);
    expect(blockers).toMatch(/' instead'/i);
    for (const table of ["acc_invoice", "acc_bill", "acc_payment", "acc_expense"]) {
      expect(blockers).toMatch(new RegExp(`left join ${table} \\w+ on`, "i"));
    }
    for (const kind of ["bill payment", "tax payment", "goods receipt", "inventory adjustment", "asset disposal", "stock count"]) {
      expect(blockers).toContain(`'${kind}'`);
    }
  });

  it("a bank entry settled against an invoice or bill", () => {
    expect(blockers).toMatch(/s\.status = 'approved' and s\.journal_line_id is null/i);
    expect(blockers).toMatch(/f\.source_type = 'bank' and f\.is_settled then\s+'is a bank line settled against an invoice or bill/i);
  });

  it("the other bank cases that cannot be removed safely", () => {
    expect(blockers).toMatch(/f\.source_type = 'bank' and f\.source_id is not null then\s+'is a recode/i);
    expect(blockers).toMatch(/f\.bank_lines = 0 then\s+'has no bank line attached/i);
    expect(blockers).toMatch(/f\.bank_lines > 1 then\s+'answers for more than one bank line/i);
  });

  it("applies the reasons in the documented order", () => {
    const at = (needle: string) => blockers.indexOf(needle);
    const order = [
      "is not in the books",
      "is not posted",
      "has already been reversed",
      "is ticked in the reconciliation",
      "in a closed period",
      "'belongs to '",
      "is a recode",
      "settled against an invoice or bill",
    ].map(at);
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("0140 how entries are removed", () => {
  it("a manual or opening-balance entry is reversed on its own date through acc_post_entry", () => {
    expect(remove).toMatch(/source_type::text in \('manual', 'opening_balance'\)/i);
    expect(remove).toMatch(/v_rev := acc_post_entry\(v_entry\.entry_date,/i);
    expect(remove).toMatch(/'Reversal of ' \|\| v_entry\.entry_number \|\| ' — ' \|\| v_reason/i);
  });

  it("swaps debit and credit and carries the rest of the line as acc_reverse_entry does", () => {
    expect(remove).toMatch(/'debit_minor', l\.credit_minor/i);
    expect(remove).toMatch(/'credit_minor', l\.debit_minor/i);
    expect(remove).toMatch(/'amount_base_minor', l\.amount_base_minor/i);
    expect(remove).toMatch(/'tax_code_id', l\.tax_code_id/i);
    expect(remove).toMatch(/'memo', 'Reversal: ' \|\| coalesce\(l\.memo, ''\)/i);
  });

  it("marks the reversal exactly as acc_reverse_entry does", () => {
    const original = functionText(strip(read("0018_manual_journal_functions.sql")), "acc_reverse_entry");
    const mark = /insert into acc_journal_reversal_link \(original_entry_id, reversal_entry_id, reason, created_by\)\s+values \((?:p_entry_id|v_entry\.id), v_rev, (?:p_reason|v_reason), auth\.uid\(\)\)/i;
    expect(original).toMatch(mark);
    expect(remove).toMatch(mark);
    const audit = /insert into acc_audit_log \(table_name, record_id, action, actor_id\)\s+values \('acc_journal_entry', (?:p_entry_id|v_entry\.id), 'reverse', auth\.uid\(\)\)/i;
    expect(original).toMatch(audit);
    expect(remove).toMatch(audit);
    expect(remove).toMatch(/v_entry\.source_type, v_entry\.id, v_entry\.currency_code, v_lines/i);
  });

  it("a bank entry is voided with its recode, its match released and its line deleted", () => {
    expect(remove).toMatch(/update acc_journal_entry set status = 'void', voided_at = now\(\)/i);
    expect(remove).toMatch(/\(id = v_entry\.id or \(source_type = 'bank' and source_id = v_entry\.id\)\)/i);
    expect(remove).toMatch(/delete from acc_reconciliation where bank_transaction_id = v_txn/i);
    expect(remove).toMatch(/delete from acc_bank_transaction where id = v_txn/i);
  });

  it("deletes only the one line, never the rest of its import batch", () => {
    expect(remove).not.toMatch(/transaction_batch_id|acc_import_batch|acc_bank_import_batch/i);
    expect(remove).not.toMatch(/delete from acc_bank_transaction where (?!id = v_txn)/i);
  });

  it("never hard-deletes a journal entry or a journal line", () => {
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_entry\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_line\b/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("lets go of ticks in a session still in progress, never a completed one", () => {
    expect(remove).toMatch(/delete from acc_reconciliation_line rl[\s\S]*?sr\.status <> 'completed'/i);
  });
});

describe("0140 the change-log row", () => {
  it("names the account, the payee, the count and the total, once", () => {
    expect(remove.match(/insert into acc_audit_log \(table_name, record_id, action, actor_id, before_json\)/gi)).toHaveLength(1);
    expect(remove).toMatch(/'acc_bank_account', p_bank_account_id, 'remove_balance_entries'/i);
    for (const key of ["account", "payee", "count", "total_minor", "reason"]) {
      expect(remove).toContain(`'${key}'`);
    }
  });

  it("the audit row comes after every change", () => {
    const row = remove.indexOf("'remove_balance_entries'");
    expect(row).toBeGreaterThan(remove.indexOf("delete from acc_bank_transaction"));
    expect(row).toBeGreaterThan(remove.indexOf("insert into acc_journal_reversal_link"));
  });
});
