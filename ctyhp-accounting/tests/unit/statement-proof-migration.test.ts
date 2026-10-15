import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0143_statement_proof.sql";

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
const proved = functionText(sql, "acc_import_bank_statement_proved");
const linesOn = functionText(sql, "acc_bank_lines_on");
const guard = functionText(sql, "acc_statement_proof_guard");
const original = functionText(strip(read("supabase/migrations/0058_atomic_documents_and_audit.sql")), "acc_import_bank_statement");
const provedBody = proved.slice(proved.indexOf("$$"));

const RPCS: [string, string, string][] = [
  ["acc_import_bank_statement_proved", "uuid, text, jsonb, jsonb", proved],
  ["acc_bank_lines_on", "uuid, date, date", linesOn],
];

const COLUMNS: [string, string][] = [
  ["statement_opening_minor", "bigint"],
  ["statement_closing_minor", "bigint"],
  ["opening_basis", "text"],
  ["closing_basis", "text"],
  ["out_by_minor", "bigint"],
  ["override_reason", "text"],
  ["overridden_by", "uuid"],
];

const MESSAGES = {
  noOpening: "The statement has no opening balance; enter the one printed on the statement",
  noClosing: "The statement has no closing balance; enter the one printed on the statement",
  out: "The statement does not add up: out by %. Only an administrator can import it anyway, with a reason.",
  notAdmin: "Only an administrator can import a statement that does not add up",
  noReason: "Give a reason for importing a statement that does not add up",
};

/** Where the function first writes anything: its call to the import every statement goes through. */
const firstWrite = provedBody.search(/from acc_import_bank_statement\(/i);

describe("0143 statement proof: shape", () => {
  it("defines exactly the two functions and the guard", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["acc_bank_lines_on", "acc_import_bank_statement_proved", "acc_statement_proof_guard"]);
  });

  it.each(RPCS)("%s is security definer with a fixed search_path", (_name, _args, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("the guard pins its search_path too, and runs as the caller, as 0135's guard does", () => {
    const header = guard.slice(0, guard.indexOf("$$"));
    expect(header).toMatch(/returns trigger/i);
    expect(header).toMatch(/set search_path = public/i);
    expect(header).not.toMatch(/security definer/i);
  });

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("is additive and idempotent: columns if not there, constraints and trigger replaced, functions created or replaced", () => {
    expect(sql).not.toMatch(/create (table|type|index|unique index|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column|function|policy|index)\b/i);
    expect(sql).not.toMatch(/drop column/i);
    const drops = [...sql.matchAll(/\bdrop (constraint|trigger) (\w+ )?(\w+)/gi)].map((m) => m[0]);
    expect(drops).toHaveLength(4);
    for (const drop of drops) expect(drop).toMatch(/drop (constraint|trigger) if exists/i);
    expect(sql.match(/create trigger/gi)).toHaveLength(1);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });
});

describe("0143 the proof columns on acc_bank_import_batch", () => {
  it.each(COLUMNS)("%s is added if not there, as a nullable %s", (column, type) => {
    expect(sql).toMatch(new RegExp(`add column if not exists ${column} ${type}[,;]`, "i"));
  });

  it("adds them in one alter table, and nothing else to the table", () => {
    const adds = [...sql.matchAll(/add column if not exists (\w+)/gi)].map((m) => m[1]);
    expect(adds).toEqual(COLUMNS.map(([c]) => c));
    expect(sql).not.toMatch(/add column if not exists \w+ \w+ (not null|default|references)\b/i);
  });

  it("checks the opening basis: printed, running, prior or typed", () => {
    expect(sql).toMatch(
      /add constraint acc_bank_import_batch_opening_basis_ck\s+check \(opening_basis in \('printed', 'running', 'prior', 'typed'\)\);/i,
    );
  });

  it("checks the closing basis: printed, running, ledger or typed", () => {
    expect(sql).toMatch(
      /add constraint acc_bank_import_batch_closing_basis_ck\s+check \(closing_basis in \('printed', 'running', 'ledger', 'typed'\)\);/i,
    );
  });

  it("checks the override reason at 500 characters", () => {
    expect(sql).toMatch(/add constraint acc_bank_import_batch_override_reason_ck\s+check \(char_length\(override_reason\) <= 500\);/i);
  });

  it("drops each constraint if it exists before adding it, so the migration can run twice", () => {
    for (const name of ["opening_basis", "closing_basis", "override_reason"]) {
      const constraint = `acc_bank_import_batch_${name}_ck`;
      const dropAt = sql.indexOf(`drop constraint if exists ${constraint}`);
      expect(dropAt, constraint).toBeGreaterThan(0);
      expect(dropAt).toBeLessThan(sql.indexOf(`add constraint ${constraint}`));
    }
  });
});

describe("0143 only the import writes the proof", () => {
  it("guards an insert or a change of any of the seven columns", () => {
    expect(sql).toMatch(
      /create trigger acc_bank_import_batch_proof_guard\s+before insert or update of statement_opening_minor, statement_closing_minor, opening_basis, closing_basis,\s+out_by_minor, override_reason, overridden_by\s+on acc_bank_import_batch\s+for each row execute function acc_statement_proof_guard\(\);/i,
    );
    expect(sql.indexOf("drop trigger if exists acc_bank_import_batch_proof_guard on acc_bank_import_batch")).toBeLessThan(
      sql.indexOf("create trigger acc_bank_import_batch_proof_guard"),
    );
  });

  it("lets through a batch inserted without a proof, a change that leaves it as it was, and the import's own write", () => {
    expect(guard).toMatch(/if coalesce\(current_setting\('acc\.statement_proof_change', true\), ''\) = 'on' then\s+return new;/i);
    for (const [column] of COLUMNS) expect(guard).toMatch(new RegExp(`new\\.${column} is null`, "i"));
    expect(guard).toMatch(/is not distinct from/i);
    expect(guard).toMatch(/raise exception 'A statement''s proof is kept with its import only through OneBook''s own steps'/i);
  });

  it("is opened by the import alone, for its own update, and closed again", () => {
    expect(sql.match(/set_config\('acc\.statement_proof_change'/gi)).toHaveLength(2);
    const open = proved.indexOf("set_config('acc.statement_proof_change', 'on', true)");
    const write = proved.indexOf("update acc_bank_import_batch");
    const close = proved.indexOf("set_config('acc.statement_proof_change', '', true)");
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThan(write);
    expect(write).toBeLessThan(close);
  });
});

describe("0143 grants", () => {
  it.each([...RPCS, ["acc_statement_proof_guard", "", guard] as [string, string, string]])(
    "%s: revoked from public and anon, executable by signed-in users and the service role",
    (name, args) => {
      const sig = `${name}\\(${args}\\)`;
      expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon;`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role;`, "i"));
    },
  );
});

describe("0143 who may call", () => {
  it("the import is for staff, checked before anything else", () => {
    expect(provedBody).toMatch(/if not acc_is_staff\(\) then\s+raise exception 'Not authorized to import bank statements'/i);
    expect(provedBody.indexOf("acc_is_staff()")).toBeLessThan(provedBody.search(/\bfrom acc_/i));
  });

  it("importing anyway is for an administrator, through the existing helper", () => {
    expect(provedBody).toMatch(/if not acc_is_admin\(\) then\s+raise exception 'Only an administrator can import a statement that does not add up'/i);
    expect(read("supabase/migrations/0003_fix_role_guards.sql")).toMatch(
      /create or replace function acc_is_admin\(\) returns boolean[\s\S]*?coalesce\(acc_current_role\(\) = 'admin', false\)/i,
    );
  });

  it("the lines are read by staff or a viewer, and nobody else (a missing role is not let through)", () => {
    expect(linesOn).toMatch(
      /if not \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\) then\s+raise exception 'Not authorized to read bank lines'/i,
    );
    expect(linesOn.slice(0, linesOn.indexOf("$$"))).toMatch(/\bstable\b/i);
    expect(linesOn).not.toMatch(/\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("0143 acc_import_bank_statement_proved: the rule", () => {
  it("has the signature and answer parts 2 and 3 code against, the same answer as the import it calls", () => {
    expect(proved).toMatch(
      /create or replace function acc_import_bank_statement_proved\(\s*p_bank_account_id uuid, p_filename text, p_rows jsonb, p_proof jsonb\s*\) returns table \(inserted int, skipped int, batch_id uuid\)/i,
    );
    expect(original).toMatch(/returns table \(inserted int, skipped int, batch_id uuid\)/i);
  });

  it("reads the opening, closing, bases, set-aside count and override from p_proof", () => {
    for (const key of ["opening_minor", "closing_minor", "opening_basis", "closing_basis", "set_aside", "override"]) {
      expect(provedBody, key).toMatch(new RegExp(`v_proof ->>? '${key}'`, "i"));
    }
    expect(provedBody).toMatch(/v_override ->> 'reason'/i);
  });

  it("recomputes the amount out from what it is sent: opening + every line - closing", () => {
    expect(provedBody).toMatch(/v_out := v_opening \+ v_lines_minor - v_closing;/i);
    expect(provedBody).toMatch(/coalesce\(sum\(\(e\.r ->> 'amount_minor'\)::bigint\), 0\)::bigint/i);
  });

  it("counts the lines marked skip in the proof, but does not import them", () => {
    // The proof's sum reads every row: no filter on the sum, no where clause after the from.
    const sum = /select count\(\*\)::integer,\s+coalesce\(sum\(\(e\.r ->> 'amount_minor'\)::bigint\), 0\)::bigint,[\s\S]*?from jsonb_array_elements\(p_rows\) as e\(r\);/i.exec(
      provedBody,
    );
    expect(sum, "the proof's sum over p_rows").not.toBeNull();
    expect(provedBody).toMatch(/\(count\(\*\) filter \(where coalesce\(e\.r -> 'skip' = 'true'::jsonb, false\)\)\)::integer/i);
    expect(provedBody).toMatch(
      /select coalesce\(jsonb_agg\(e\.r order by e\.n\), '\[\]'::jsonb\)\s+into v_import\s+from jsonb_array_elements\(p_rows\) with ordinality as e\(r, n\)\s+where not coalesce\(e\.r -> 'skip' = 'true'::jsonb, false\);/i,
    );
    expect(provedBody).toMatch(/from acc_import_bank_statement\(p_bank_account_id, p_filename, v_import\) as x;/i);
  });

  it("imports through acc_import_bank_statement itself, and writes no bank line of its own", () => {
    expect(provedBody.match(/acc_import_bank_statement\(/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/insert\s+into\s+acc_bank_transaction\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_bank_import_batch\b/i);
    expect(provedBody).toMatch(/select x\.inserted, x\.skipped, x\.batch_id\s+into v_inserted, v_skipped, v_batch/i);
    expect(provedBody).toMatch(/return query select v_inserted, v_skipped, v_batch;/i);
  });

  it("writes nothing when no line is left to import", () => {
    expect(provedBody).toMatch(/if jsonb_array_length\(v_import\) > 0 then\s+select x\.inserted/i);
    expect(provedBody).toMatch(/v_inserted\s+integer := 0;/i);
    expect(provedBody).toMatch(/v_skipped\s+integer := 0;/i);
  });
});

describe("0143 acc_import_bank_statement_proved: refusals", () => {
  it("refuses a missing opening, then a missing closing, word for word", () => {
    expect(provedBody).toMatch(new RegExp(`if v_opening is null then\\s+raise exception '${MESSAGES.noOpening}'`, "i"));
    expect(provedBody).toMatch(new RegExp(`if v_closing is null then\\s+raise exception '${MESSAGES.noClosing}'`, "i"));
    expect(provedBody.indexOf(MESSAGES.noOpening)).toBeLessThan(provedBody.indexOf(MESSAGES.noClosing));
  });

  it("refuses a statement out with no override, with the absolute amount formatted as 0142 formats money", () => {
    const escaped = MESSAGES.out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(provedBody).toMatch(
      new RegExp(
        `if v_override is null or jsonb_typeof\\(v_override\\) = 'null' then\\s+raise exception '${escaped}',\\s+to_char\\(abs\\(v_out\\) / 100\\.0, 'FM999,999,999,990\\.00'\\);`,
        "i",
      ),
    );
    expect(read("supabase/migrations/0142_reconciliation_history.sql")).toMatch(
      /to_char\(abs\(v_balance - p_balance_minor\) \/ 100\.0, 'FM999,999,999,990\.00'\)/i,
    );
  });

  it("refuses an override from anyone but an administrator, then one with a blank reason", () => {
    expect(provedBody).toMatch(new RegExp(`raise exception '${MESSAGES.notAdmin}'`, "i"));
    expect(provedBody).toMatch(/v_reason := btrim\(coalesce\(v_override ->> 'reason', ''\)\);/i);
    expect(provedBody).toMatch(new RegExp(`if v_reason = '' then\\s+raise exception '${MESSAGES.noReason}'`, "i"));
    expect(provedBody.indexOf(MESSAGES.notAdmin)).toBeLessThan(provedBody.indexOf(MESSAGES.noReason));
  });

  it("looks at an override only when the statement is out", () => {
    const out = provedBody.indexOf("if v_out <> 0 then");
    expect(out).toBeGreaterThan(0);
    for (const message of [MESSAGES.out, MESSAGES.notAdmin, MESSAGES.noReason]) {
      expect(provedBody.indexOf(message.slice(0, 30)), message).toBeGreaterThan(out);
    }
    expect(provedBody).toMatch(/override_reason = case when v_out <> 0 then v_reason end/i);
    expect(provedBody).toMatch(/overridden_by = case when v_out <> 0 then auth\.uid\(\) end/i);
  });

  it("refuses a basis outside the columns' checks, a line without an amount and an unknown account", () => {
    expect(provedBody).toMatch(/v_opening_basis not in \('printed', 'running', 'prior', 'typed'\)/i);
    expect(provedBody).toMatch(/v_closing_basis not in \('printed', 'running', 'ledger', 'typed'\)/i);
    expect(provedBody).toMatch(/raise exception 'Every statement line needs an amount'/i);
    expect(provedBody).toMatch(/raise exception 'Bank account not found'/i);
    expect(provedBody).toMatch(/if char_length\(v_reason\) > 500 then\s+raise exception/i);
  });

  it("makes every refusal before anything is written", () => {
    expect(firstWrite).toBeGreaterThan(0);
    for (const message of [
      "Not authorized to import bank statements",
      "Bank account not found",
      "Every statement line needs an amount",
      MESSAGES.noOpening,
      MESSAGES.noClosing,
      "Say where the opening balance came from",
      "Say where the closing balance came from",
      MESSAGES.out.slice(0, 30),
      MESSAGES.notAdmin,
      MESSAGES.noReason,
      "Keep the reason to 500 characters",
    ]) {
      const at = provedBody.indexOf(message);
      expect(at, message).toBeGreaterThan(0);
      expect(at, message).toBeLessThan(firstWrite);
    }
  });
});

describe("0143 acc_import_bank_statement_proved: what it keeps", () => {
  it("stores the proof on the batch the import made", () => {
    expect(provedBody).toMatch(
      /update acc_bank_import_batch\s+set statement_opening_minor = v_opening,\s+statement_closing_minor = v_closing,\s+opening_basis = v_opening_basis,\s+closing_basis = v_closing_basis,\s+out_by_minor = v_out,/i,
    );
    expect(provedBody).toMatch(/where id = v_batch;/i);
  });

  it("writes one audit row for an override, with the reason, the amount out, the account and the file name", () => {
    expect(provedBody.match(/insert into acc_audit_log/gi)).toHaveLength(1);
    const audit = provedBody.slice(provedBody.indexOf("insert into acc_audit_log"));
    expect(audit).toMatch(/values \('acc_bank_import_batch', v_batch, 'override', auth\.uid\(\),/i);
    for (const key of ["bank_account_id", "account", "filename", "reason", "out_by_minor"]) {
      expect(audit, key).toContain(`'${key}'`);
    }
    const guarded = provedBody.slice(provedBody.lastIndexOf("if v_out <> 0 then"));
    expect(guarded.indexOf("insert into acc_audit_log")).toBeGreaterThan(0);
  });
});

describe("0143 acc_bank_lines_on", () => {
  it("returns the documented columns", () => {
    expect(linesOn).toMatch(
      /create or replace function acc_bank_lines_on\(p_bank_account_id uuid, p_from date, p_to date\)\s+returns table \(id uuid, txn_date date, amount_minor bigint, raw_hash text, source_kind text, import_batch_id uuid\)/i,
    );
  });

  it("names the source: the books by a ledger: hash, then a bank feed, then an import, else other", () => {
    expect(linesOn).toMatch(
      /case\s+when t\.raw_hash like 'ledger:%' then 'books'\s+when t\.source = 'bank_feed' then 'feed'\s+when t\.import_batch_id is not null or t\.transaction_batch_id is not null then 'import'\s+else 'other'\s+end/i,
    );
    expect(read("supabase/migrations/0045_bank_feeds.sql")).toMatch(/check \(source in \('file_upload', 'bank_feed'\)\)/i);
    expect(read("supabase/migrations/0108_transaction_import_batches.sql")).toMatch(
      /add column if not exists transaction_batch_id uuid references acc_import_batch \(id\)/i,
    );
  });

  it("reads the account's lines in the range, leaving out feed lines the bank withdrew", () => {
    expect(linesOn).toMatch(
      /where t\.bank_account_id = p_bank_account_id\s+and t\.provider_removed_at is null\s+and t\.txn_date between p_from and p_to/i,
    );
    expect(linesOn).toMatch(/if p_from is null or p_to is null then\s+raise exception/i);
  });

  it("orders by date, then id, so a caller can page past the 1,000-row cap", () => {
    expect(linesOn).toMatch(/order by t\.txn_date, t\.id;/i);
  });
});

describe("0143 leaves acc_import_bank_statement as it was", () => {
  it("neither replaces, alters, revokes nor drops it", () => {
    expect(sql).not.toMatch(/function acc_import_bank_statement\(/i);
    expect(sql).not.toMatch(/\bacc_import_bank_statement\(uuid, text, jsonb\)/i);
  });

  it("no migration after 0058 redefines it, so 0058's is the one the new import calls", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const definers = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      // A definition, not a mention: 0146 revokes it, which is no redefinition.
      .filter((f) => /create\s+(or\s+replace\s+)?function\s+acc_import_bank_statement\s*\(/i.test(strip(read(`supabase/migrations/${f}`))));
    expect(definers).toEqual(["0058_atomic_documents_and_audit.sql"]);
    expect(original).toMatch(/on conflict \(bank_account_id, raw_hash\) do nothing/i);
    expect(original).toMatch(/return query select v_inserted, v_count - v_inserted, v_batch;/i);
  });
});

describe("0143 nothing posts", () => {
  it("never calls a posting function and never writes the ledger", () => {
    expect(sql).not.toMatch(/acc_post_entry/i);
    expect(sql).not.toMatch(/acc_post_manual_journal|acc_record_reconciliation_adjustment|acc_reverse_entry/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/update\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_(entry|line)\b/i);
  });

  it("never touches matches, reconciliations or statement files", () => {
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+acc_(reconciliation|statement_reconciliation|saved_report)\b/i);
  });
});
