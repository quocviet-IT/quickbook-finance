import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0192 (3.0.23, item C of the defect report of 11 Nov 2026): a posted,
 * matched or reconciled bank line is not deleted. What it does on real books
 * is proved by scripts/verify-refuse-delete-posted-line.mjs; this holds the
 * file's shape, so a later edit cannot quietly undo it.
 */
const read = (file: string) => readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8").replace(/\r\n/g, "\n");
const sql = read("0192_refuse_delete_posted_bank_line.sql");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");

/** The body of one function, from its `create or replace` to its closing `$$;`. */
function body(source: string, name: string): string {
  const start = source.search(new RegExp(`create or replace function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is not defined`);
  return source.slice(start, source.indexOf("\n$$;", source.indexOf("as $$", start)) + 4);
}

describe("0192_refuse_delete_posted_bank_line", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("adds Delete bank lines under Banking, for staff, given to admins and accountants only", () => {
    expect(code).toMatch(/insert into acc_permission \(key, label, category, description, is_enforced, min_role\)\nvalues \('banking\.delete_line', 'Delete bank lines', 'Banking',/);
    expect(code).toMatch(/true, 'staff'\)\non conflict \(key\) do update/);
    expect(code).toMatch(/select role, 'banking\.delete_line', role in \('admin'::acc_app_role, 'accountant'::acc_app_role\)/);
    // A company that already took it away from a role keeps it taken away.
    expect(code).toMatch(/on conflict \(role, permission_key\) do nothing;/);
  });

  it("deletes a line only when the database says it may, after checking the permission and the reason", () => {
    const del = body(code, "acc_delete_bank_transaction");
    const order = [
      "if not acc_is_staff() or not acc_has_permission('banking.delete_line') then",
      "Say why this line is being deleted, in a sentence",
      "for update;",
      "v_state := acc_bank_line_delete_state(p_id);",
      "if v_state ->> 'kind' <> 'deletable' then",
      "delete from acc_bank_transaction where id = p_id;",
      "to_jsonb(v_row) || jsonb_build_object('reason', btrim(p_reason))",
    ].map((part) => del.indexOf(part));
    expect(order.every((at) => at > 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("no longer voids anything on the way to a delete", () => {
    const old = body(code, "acc_delete_bank_transaction_with_void");
    expect(old).toContain("perform acc_delete_bank_transaction(p_id, p_reason);");
    expect(old).not.toMatch(/acc_uncategorise_bank_transaction|status = 'void'|update acc_journal_entry/);
    expect(body(code, "acc_delete_bank_transaction")).not.toMatch(/acc_uncategorise_bank_transaction|status = 'void'|update acc_journal_entry/);
  });

  it("names every kind of line and the way out of each", () => {
    const state = body(code, "acc_bank_line_delete_state");
    for (const kind of ["ignored", "matched", "suggested", "deletable", "settled", "reconciled", "import_batch", "posted"]) {
      expect(state, kind).toContain(`'kind', '${kind}'`);
    }
    expect(state).toMatch(/language plpgsql stable security definer set search_path = public/);
    expect(state).toContain("Reopen that reconciliation to change it.");
    expect(state).toContain("Void that entry first");
    expect(state).toContain("Unmatch it first: the entry and the line both stay.");
    // A reconciled line says so before anything about who posted it.
    expect(state.indexOf("'kind', 'reconciled'")).toBeLessThan(state.indexOf("'kind', 'import_batch'"));
    expect(state.indexOf("'kind', 'reconciled'")).toBeLessThan(state.indexOf("'kind', 'posted'"));
  });

  it("unmatches only a line matched to an entry posted elsewhere, and keeps what it took back", () => {
    const unmatch = body(code, "acc_unmatch_bank_transaction");
    expect(unmatch).toContain("if not acc_is_staff() or not acc_has_permission('banking.match') then");
    expect(unmatch).toContain("elsif v_kind <> 'matched' then");
    expect(unmatch).toContain("delete from acc_reconciliation where id = v_rec.id;");
    expect(unmatch).toContain("update acc_bank_transaction set status = 'unmatched'");
    expect(unmatch).not.toMatch(/update acc_journal_entry|status = 'void'/);
    expect(unmatch).toContain("'unmatch', auth.uid()");
  });

  it("keeps Remove these N entries as 0140 wrote it, but for the permission and the whole line in the audit log", () => {
    const original = body(read("0140_remove_balance_entries.sql"), "acc_remove_balance_entries").split("\n");
    const copy = body(sql, "acc_remove_balance_entries").split("\n");
    const added = copy.filter((line) => !original.includes(line));
    expect(copy.filter((line) => original.includes(line))).toEqual(original);
    expect(added.join("\n")).toContain("if not acc_has_permission('banking.delete_line') then");
    expect(added.join("\n")).toContain("to_jsonb(t) || jsonb_build_object('reason', v_reason,");
    // The check and the audit row come before the line is deleted.
    const text = copy.join("\n");
    expect(text.indexOf("acc_has_permission('banking.delete_line')")).toBeLessThan(text.indexOf("delete from acc_bank_transaction where id = v_txn;"));
    expect(text.indexOf("to_jsonb(t) ||")).toBeLessThan(text.indexOf("delete from acc_bank_transaction where id = v_txn;"));
  });

  it("opens every function to signed-in users and the service role, and to no one else", () => {
    for (const signature of [
      "acc_bank_line_delete_state(uuid)",
      "acc_delete_bank_transaction(uuid, text)",
      "acc_delete_bank_transaction_with_void(uuid, text)",
      "acc_unmatch_bank_transaction(uuid, text)",
      "acc_remove_balance_entries(uuid, uuid[], text)",
    ]) {
      const escaped = signature.replace(/[()[\]]/g, "\\$&");
      expect(code, signature).toMatch(new RegExp(`revoke all on function ${escaped} from public, anon;`));
      expect(code, signature).toMatch(new RegExp(`grant execute on function ${escaped}\\s+to authenticated, service_role;`));
    }
  });

  it("changes no table: functions, one permission and its grants", () => {
    expect(code).not.toMatch(/\b(alter table|drop table|create table|truncate)\b/i);
  });
});
