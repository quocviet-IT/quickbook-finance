import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { PAIRING_WINDOW_DAYS } from "@/lib/domain/statement-pairing";

const FILE = "0142_reconciliation_history.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, so naming a thing in prose never reads as doing it. */
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

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const history = functionText(sql, "acc_bring_history_forward");
const wrapper = functionText(sql, "acc_bring_forward_reconciliation");
const discard = functionText(sql, "acc_discard_reconciliation");
const listing = functionText(sql, "acc_reconciliation_history");
const aside = functionText(sql, "acc_set_statement_line_aside");
const duplicates = functionText(sql, "acc_statement_line_duplicates");
const original = functionText(strip(read("supabase/migrations/0132_reconcile_from_statement.sql")), "acc_bring_forward_reconciliation");
const reconciliationLines = (() => {
  const text = strip(read("supabase/migrations/0132_reconcile_from_statement.sql"));
  const start = text.search(/create function acc_reconciliation_lines\(/i);
  return text.slice(start, text.indexOf("$$;", text.indexOf("$$", start) + 2) + 3);
})();

const FUNCTIONS: [string, string, string][] = [
  ["acc_bring_history_forward", "uuid, date, bigint, text", history],
  ["acc_bring_forward_reconciliation", "uuid, date, bigint, text", wrapper],
  ["acc_discard_reconciliation", "uuid, text", discard],
  ["acc_reconciliation_history", "", listing],
  ["acc_set_statement_line_aside", "uuid, integer, boolean", aside],
  ["acc_statement_line_duplicates", "uuid, integer\\[\\]", duplicates],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("0142 reconciliation history: shape", () => {
  it("defines exactly the five new functions and 0132's bring-forward", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(FUNCTIONS.map(([name]) => name).sort());
  });

  it.each(FUNCTIONS)("%s is security definer with a fixed search_path", (_name, _args, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("is additive and idempotent: one column if not there, functions created or replaced", () => {
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column|function|policy|index|trigger)\b/i);
    expect(sql).not.toMatch(/alter table \w+ drop\b/i);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });
});

describe("0142 the new column", () => {
  it("acc_reconciliation_statement_line gains set_aside, not null and false by default", () => {
    expect(sql).toMatch(
      /alter table acc_reconciliation_statement_line\s+add column if not exists set_aside boolean not null default false;/i,
    );
  });

  it("only acc_set_statement_line_aside writes it", () => {
    const writers = [...sql.matchAll(/update acc_reconciliation_statement_line set set_aside/gi)];
    expect(writers).toHaveLength(1);
    expect(aside).toMatch(/update acc_reconciliation_statement_line set set_aside = p_aside where id = v_line\.id/i);
  });
});

describe("0142 grants", () => {
  it.each(FUNCTIONS)("%s: revoked from public and anon, executable by signed-in users and the service role", (name, args) => {
    const sig = `${name}\\(${args}\\)`;
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon;`, "i"));
    expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role;`, "i"));
  });
});

describe("0142 who may call", () => {
  it.each([
    ["acc_bring_history_forward", history],
    ["acc_bring_forward_reconciliation", wrapper],
    ["acc_discard_reconciliation", discard],
    ["acc_set_statement_line_aside", aside],
  ])("%s writes, so it requires staff before anything else", (_name, text) => {
    const body = text.slice(text.indexOf("$$"));
    expect(body).toMatch(/if not acc_is_staff\(\) then\s+raise exception 'Not authorized/i);
    expect(body.indexOf("acc_is_staff()")).toBeLessThan(body.search(/\bfrom acc_/i));
  });

  it.each([
    ["acc_reconciliation_history", listing],
    ["acc_statement_line_duplicates", duplicates],
  ])("%s reads, for staff or a viewer, and refuses anyone else (a missing role is not let through)", (_name, text) => {
    expect(text).toMatch(
      /if not \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\) then\s+raise exception 'Not authorized/i,
    );
    expect(text.slice(0, text.indexOf("$$"))).toMatch(/\bstable\b/i);
    expect(text).not.toMatch(/\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("0142 nothing posts", () => {
  it("never calls a posting function and never writes the ledger", () => {
    expect(sql).not.toMatch(/acc_post_entry/i);
    expect(sql).not.toMatch(/acc_post_manual_journal|acc_record_reconciliation_adjustment|acc_reverse_entry/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/update\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_(entry|line)\b/i);
  });

  it("never touches bank lines, statement files or matches", () => {
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+acc_(bank_transaction|saved_report|reconciliation)\b(?!_)/i);
  });
});

describe("0142 acc_bring_history_forward", () => {
  it("returns the new session, its lines, the ticks moved and the session it rebased", () => {
    expect(history).toMatch(/returns jsonb/i);
    expect(history).toMatch(
      /jsonb_build_object\('reconciliation_id', v_id,\s*'lines', v_moved \+ v_added,\s*'moved', v_moved,\s*'rebased_reconciliation_id', v_open\.id\)/i,
    );
  });

  it("refuses a missing date or balance, and a date past the company's today", () => {
    expect(history).toMatch(/if p_through is null then\s+raise exception/i);
    expect(history).toMatch(/if p_balance_minor is null then\s+raise exception/i);
    expect(history).toMatch(/now\(\) at time zone s\.time_zone/i);
    expect(history).toMatch(/if p_through > v_today then\s+raise exception 'A bank account cannot be brought forward past today'/i);
  });

  it("locks the bank account row before reading any reconciliation", () => {
    expect(history).toMatch(/where b\.id = p_bank_account_id\s+for update of b;/i);
    expect(history.indexOf("for update of b")).toBeLessThan(history.indexOf("from acc_statement_reconciliation"));
  });

  it("refuses an account that already has a completed reconciliation", () => {
    expect(history).toMatch(
      /bank_account_id = p_bank_account_id and status = 'completed'\) then\s+raise exception 'This account already has a completed reconciliation\.'/i,
    );
  });

  it("locks the session in progress, and refuses one that ends on or before the date", () => {
    expect(history).toMatch(/status = 'in_progress'\s+for update;/i);
    expect(history).toMatch(
      /v_open\.statement_ending_date <= p_through then\s+raise exception 'Finish or discard the reconciliation in progress first\.'/i,
    );
  });

  it("refuses a mismatch with both figures, the date and the absolute amount it is out by, money formatted as 0132 formats it", () => {
    expect(history).toMatch(/if v_balance <> p_balance_minor then/i);
    expect(history).toMatch(/raise exception 'The books hold % on %; the statement shows %\. Out by %\.'/i);
    expect(history).toMatch(/to_char\(v_balance \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(history).toMatch(/to_char\(p_balance_minor \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(history).toMatch(/to_char\(abs\(v_balance - p_balance_minor\) \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(original).toMatch(/to_char\(v_balance \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
  });

  it("measures the books exactly as 0132 did: posted lines on the ledger account, signed, in the base currency", () => {
    const balance =
      /coalesce\(sum\(case when l\.debit_minor > 0 then l\.amount_base_minor else -l\.amount_base_minor end\), 0\)::bigint[\s\S]*?where l\.account_id = v_gl and e\.status = 'posted' and e\.entry_date <= p_through/i;
    expect(history).toMatch(balance);
    expect(original).toMatch(balance);
  });

  it("makes every refusal before anything is written", () => {
    const firstWrite = history.search(/insert into acc_statement_reconciliation/i);
    expect(firstWrite).toBeGreaterThan(0);
    for (const refusal of [
      "past today",
      "Bank account not found",
      "already has a completed reconciliation",
      "Finish or discard",
      "The books hold",
    ]) {
      expect(history.indexOf(refusal), refusal).toBeGreaterThan(0);
      expect(history.indexOf(refusal), refusal).toBeLessThan(firstWrite);
    }
  });

  it("creates one completed, brought-forward session that begins at 0 and ends at the statement balance", () => {
    expect(history).toMatch(
      /values \(p_bank_account_id, p_through, 0, p_balance_minor,\s*'completed', auth\.uid\(\), auth\.uid\(\), now\(\), v_note, true\)/i,
    );
  });

  it("moves the session's ticks on posted lines through the date, keeping when each was ticked", () => {
    expect(history).toMatch(/delete from acc_reconciliation_line rl[\s\S]*?rl\.reconciliation_id = v_open\.id[\s\S]*?e\.entry_date <= p_through[\s\S]*?returning rl\.journal_line_id, rl\.cleared_at/i);
    expect(history).toMatch(/insert into acc_reconciliation_line \(reconciliation_id, journal_line_id, cleared_at\)\s+select v_id, m\.journal_line_id, m\.cleared_at from moved m/i);
  });

  it("then ticks every other posted line through the date", () => {
    expect(history).toMatch(
      /insert into acc_reconciliation_line \(reconciliation_id, journal_line_id\)\s+select v_id, l\.id[\s\S]*?e\.status = 'posted' and e\.entry_date <= p_through[\s\S]*?not exists \(select 1 from acc_reconciliation_line x\s+where x\.reconciliation_id = v_id and x\.journal_line_id = l\.id\)/i,
    );
  });

  it("rebases the session in progress on the statement balance", () => {
    expect(history).toMatch(/set beginning_balance_minor = p_balance_minor, updated_at = now\(\)\s+where id = v_open\.id/i);
  });

  it("writes audit rows for the new session and the one it changed, with the account, the date, the balance and the lines", () => {
    expect(history).toMatch(/\('acc_statement_reconciliation', v_id, 'insert', auth\.uid\(\),/i);
    expect(history).toMatch(/\('acc_statement_reconciliation', v_id, 'post', auth\.uid\(\), null\)/i);
    expect(history).toMatch(/\('acc_statement_reconciliation', v_open\.id, 'update', auth\.uid\(\),/i);
    for (const key of ["bank_account_id", "account", "through", "balance_minor", "beginning_balance_minor", "lines", "moved"]) {
      expect(history).toContain(`'${key}'`);
    }
  });
});

describe("0142 acc_bring_forward_reconciliation (0132) on the shared rule", () => {
  it("keeps 0132's signature and return type", () => {
    expect(wrapper).toMatch(
      /create or replace function acc_bring_forward_reconciliation\(\s*p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text\s*\) returns uuid/i,
    );
  });

  it("keeps its own refusal of an account with any reconciliation, word for word, after locking the account", () => {
    const message = "This bank account already has a reconciliation; only the first one can be brought forward";
    expect(original).toContain(message);
    expect(wrapper).toContain(message);
    expect(wrapper).toMatch(/from acc_statement_reconciliation where bank_account_id = p_bank_account_id\) then/i);
    expect(wrapper.indexOf("for update")).toBeLessThan(wrapper.indexOf(message));
  });

  it("then calls acc_bring_history_forward and returns the new id, measuring nothing itself", () => {
    expect(wrapper).toMatch(
      /return \(acc_bring_history_forward\(p_bank_account_id, p_through, p_opening_minor, p_note\)\s*->> 'reconciliation_id'\)::uuid;/i,
    );
    expect(wrapper.indexOf("already has a reconciliation")).toBeLessThan(wrapper.indexOf("acc_bring_history_forward("));
    expect(wrapper).not.toMatch(/sum\(|insert into/i);
  });
});

describe("0142 acc_discard_reconciliation", () => {
  it("returns the number of ticks removed", () => {
    expect(discard).toMatch(/returns integer/i);
    expect(discard).toMatch(/select count\(\*\)::integer into v_ticks\s+from acc_reconciliation_line where reconciliation_id = p_reconciliation_id/i);
    expect(discard).toMatch(/return v_ticks;/i);
  });

  it("refuses a blank reason, an unknown session, and anything not in progress", () => {
    expect(discard).toMatch(/v_reason\s+text := btrim\(coalesce\(p_reason, ''\)\)/i);
    expect(discard).toMatch(/if v_reason = '' then\s+raise exception 'A reason is required to discard a reconciliation'/i);
    expect(discard).toMatch(/where id = p_reconciliation_id for update;/i);
    expect(discard).toMatch(/raise exception 'Reconciliation not found'/i);
    expect(discard).toMatch(/if v_rec\.status <> 'in_progress' then\s+raise exception 'Only a reconciliation in progress can be discarded'/i);
  });

  it("refuses while its adjustment entry is not void, naming the entry", () => {
    expect(discard).toMatch(/select \* into v_adj from acc_journal_entry where id = v_rec\.adjustment_entry_id/i);
    expect(discard).toMatch(/if found and v_adj\.status <> 'void' then/i);
    expect(discard).toMatch(/raise exception 'This reconciliation posted an adjustment \(%\), so it cannot be discarded\.', v_adj\.entry_number/i);
  });

  it("deletes the session only, letting its ticks and statement lines go by cascade", () => {
    expect(discard).toMatch(/delete from acc_statement_reconciliation where id = p_reconciliation_id;/i);
    expect(discard.match(/delete from/gi)).toHaveLength(1);
    for (const table of ["0025_bank_reconciliation.sql", "0132_reconcile_from_statement.sql"]) {
      expect(read(`supabase/migrations/${table}`)).toMatch(
        /reconciliation_id uuid not null references acc_statement_reconciliation \(id\) on delete cascade/i,
      );
    }
  });

  it("makes every refusal before the delete", () => {
    const deleted = discard.indexOf("delete from acc_statement_reconciliation");
    for (const refusal of ["A reason is required", "Reconciliation not found", "Only a reconciliation in progress", "so it cannot be discarded"]) {
      expect(discard.indexOf(refusal), refusal).toBeLessThan(deleted);
    }
  });

  it("writes one audit row with the reason, the account, the statement ending date and the ticks, after the delete", () => {
    expect(discard.match(/insert into acc_audit_log/gi)).toHaveLength(1);
    expect(discard).toMatch(/insert into acc_audit_log \(table_name, record_id, action, actor_id, before_json\)/i);
    expect(discard).toMatch(/'acc_statement_reconciliation', p_reconciliation_id, 'delete'/i);
    for (const key of ["bank_account_id", "account", "statement_ending_date", "ticks", "reason"]) {
      expect(discard).toContain(`'${key}'`);
    }
    expect(discard.indexOf("insert into acc_audit_log")).toBeGreaterThan(discard.indexOf("delete from acc_statement_reconciliation"));
  });
});

describe("0142 acc_reconciliation_history", () => {
  it("returns the documented columns", () => {
    expect(listing).toMatch(
      /returns table \(bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date,\s*last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date\)/i,
    );
  });

  it("gives one row per bank account", () => {
    expect(listing).toMatch(/from acc_bank_account b\s+left join unheld u[\s\S]*?left join last_done d[\s\S]*?left join acc_statement_reconciliation ip/i);
    expect(listing).toMatch(/coalesce\(u\.n, 0\)/i);
  });

  it("counts open lines as 0133 does: posted lines that no COMPLETED reconciliation holds", () => {
    expect(listing).toMatch(/where r\.status = 'completed'/i);
    expect(listing).toMatch(/where e\.status = 'posted'/i);
    expect(listing).toMatch(/not exists \(select 1 from held h where h\.line_id = l\.id\)/i);
    expect(read("supabase/migrations/0133_bank_open_lines.sql")).toMatch(/r\.status = 'completed'/i);
  });

  it("reads the in-progress session and the last completed ending date", () => {
    expect(listing).toMatch(/max\(r\.statement_ending_date\)/i);
    expect(listing).toMatch(/ip\.bank_account_id = b\.id and ip\.status = 'in_progress'/i);
  });
});

describe("0142 acc_set_statement_line_aside", () => {
  it("is for a line that exists, in a session in progress", () => {
    expect(aside).toMatch(/returns void/i);
    expect(aside).toMatch(/if v_rec\.status <> 'in_progress' then\s+raise exception 'Reconciliation is not in progress'/i);
    expect(aside).toMatch(/where reconciliation_id = p_reconciliation_id and line_no = p_line_no/i);
    expect(aside).toMatch(/raise exception 'Statement line not found'/i);
  });

  it("leaves the paired check to the reconcile service, and says so in the header", () => {
    expect(raw).toMatch(/\(statementStandings\) and is not stored, so[\s\S]{0,120}refusal of a paired line lives in the[\s\S]{0,80}reconcile service, not here\./i);
  });

  it("writes an audit row when the mark changes, and nothing when it does not", () => {
    expect(aside).toMatch(/if v_line\.set_aside = p_aside then\s+return;/i);
    expect(aside).toMatch(/'acc_statement_reconciliation', p_reconciliation_id, 'update'/i);
    expect(aside.indexOf("insert into acc_audit_log")).toBeGreaterThan(aside.indexOf("update acc_reconciliation_statement_line"));
  });
});

describe("0142 acc_statement_line_duplicates", () => {
  it("returns the documented columns, at most 500 lines at a time", () => {
    expect(duplicates).toMatch(
      /returns table \(line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date\)/i,
    );
    expect(duplicates).toMatch(/if coalesce\(cardinality\(p_line_nos\), 0\) > 500 then\s+raise exception 'At most 500 statement lines can be checked at once'/i);
  });

  it("looks only at posted lines on the session's bank ledger account", () => {
    expect(duplicates).toMatch(/from acc_statement_reconciliation r join acc_bank_account b on b\.id = r\.bank_account_id/i);
    expect(duplicates).toMatch(/where l\.account_id = v_gl\s+and e\.status = 'posted'/i);
  });

  it("signs a book line as the pairing does, and compares it with the statement amount as written", () => {
    const signed = "(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint";
    expect(duplicates).toContain(signed);
    expect(reconciliationLines).toContain(signed);
    expect(duplicates).toMatch(/join book k on k\.b_minor = a\.ask_minor/i);
    expect(duplicates).not.toMatch(/-\s*a\.ask_minor|abs\(k\.b_minor\)|abs\(a\.ask_minor\)/i);
  });

  it("takes the book line's reference exactly as acc_reconciliation_lines does", () => {
    const reference = "coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference";
    expect(reconciliationLines).toContain(reference);
    expect(duplicates).toContain(reference);
    for (const join of [
      "left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id",
      "left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id",
    ]) {
      expect(reconciliationLines).toContain(join);
      expect(duplicates).toContain(join);
    }
  });

  it("cleans a cheque number with the pairing's own rule, and an empty one never matches", () => {
    const pairing = read("lib/domain/statement-pairing.ts");
    const rule = /export function cleanReference[\s\S]*?\.replace\(\/(\[[^\]]+\])\/g, ""\)/.exec(pairing);
    expect(rule, "cleanReference keeps its one replace").not.toBeNull();
    const cleaned = new RegExp(`regexp_replace\\([^;]*?'${escape(rule![1])}', '', 'g'\\)`, "gi");
    expect(duplicates.match(cleaned)).toHaveLength(2);
    expect(duplicates).toMatch(/\(a\.ask_ref <> '' and k\.b_ref = a\.ask_ref\)/i);
  });

  it("matches by reference or within the pairing window of days", () => {
    expect(PAIRING_WINDOW_DAYS).toBe(5);
    expect(duplicates).toMatch(new RegExp(`or abs\\(k\\.e_on - a\\.ask_on\\) <= ${PAIRING_WINDOW_DAYS}`, "i"));
  });

  it("orders by statement line, then entry date, then entry number", () => {
    expect(duplicates).toMatch(/order by a\.ask_no, k\.e_on, k\.e_number, k\.line_id;/i);
  });
});
