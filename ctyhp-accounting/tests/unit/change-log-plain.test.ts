import { describe, expect, it } from "vitest";
import { changeLog, changeLogDetail, visibleChanges, type ChangeLogEntry } from "@/lib/domain/change-log";
import { ACTIVITY_VERBS, isSystemActivity } from "@/lib/domain/audit-entities";

/**
 * The Change Log in plain words. The UI review of 2026-10-17 found
 * "due_date: (empty); lifecycle: dismissed" under a record called "Work item
 * state", "Book: 426500" for a cash count, and 620 lines a month, most of them
 * the system's own activity rather than changes to the books.
 */
describe("changeLogDetail writes sentences", () => {
  it("says what changed, from what, to what", () => {
    expect(changeLogDetail({ before_json: { status: "draft" }, after_json: { status: "void" } })).toBe(
      "Status changed from Draft to Void.",
    );
    expect(changeLogDetail({ before_json: { due_date: null }, after_json: { due_date: "2026-10-20" } })).toBe(
      "Due date set to 10/20/2026.",
    );
    expect(changeLogDetail({ before_json: { memo: "Rent" }, after_json: { memo: "" } })).toBe(
      "Memo cleared (was “Rent”).",
    );
    expect(changeLogDetail({ before_json: { is_clearing: false }, after_json: { is_clearing: true } })).toBe(
      "Clearing changed from no to yes.",
    );
  });

  it("writes money as money, in the record's own currency", () => {
    expect(
      changeLogDetail({
        before_json: null,
        after_json: { book_minor: 426500, counted_minor: 425250, counted_on: "2026-10-17", status: "posted" },
      }),
    ).toBe("Status: Posted. Book: $4,265.00. Counted: $4,252.50. And 1 more.");
    expect(changeLogDetail({ before_json: { total_minor: 1000 }, after_json: { total_minor: 1250 } })).toBe(
      "Total changed from $10.00 to $12.50.",
    );
  });

  it("reads a stored code as words, and leaves what a person typed in quotes", () => {
    expect(
      changeLogDetail({
        before_json: null,
        after_json: { name: "Cash Over and Short", account_type: "other_expense", is_contra: false, is_clearing: false },
      }),
    ).toBe("Name: Cash Over and Short. Account type: Other expense.");
    expect(
      changeLogDetail({ before_json: null, after_json: { reason: "Smoke check, discarded", lifecycle: "dismissed" } }),
    ).toBe("Reason: “Smoke check, discarded”. Status: Dismissed.");
  });

  it("says what a removed record held", () => {
    expect(
      changeLogDetail({ before_json: { name: "Example Affiliate LLC", is_active: true }, after_json: null }),
    ).toBe("Name: Example Affiliate LLC. Active.");
  });

  it("leaves out keys, links, stamps, hashes and the work queue's internal key", () => {
    expect(
      changeLogDetail({
        before_json: null,
        after_json: { id: "1", account_id: "a", created_at: "t", sha256: "f00", storage_path: "x/y", work_key: "bank-txn:1" },
      }),
    ).toBe("");
  });
});

describe("the system's own activity", () => {
  const row = (table_name: string, action: string, actor_id: string | null = "user-1") => ({ table_name, action, actor_id });

  it("is the work queue, kept files, a reconciliation's own matches, backups and anything no person did", () => {
    expect(isSystemActivity(row("acc_work_item_state", "update"))).toBe(true);
    expect(isSystemActivity(row("acc_saved_report", "keep_statement_file"))).toBe(true);
    expect(isSystemActivity(row("acc_bank_import_batch", "statement_file"))).toBe(true);
    expect(isSystemActivity(row("acc_reconciliation", "match_from_reconciliation"))).toBe(true);
    expect(isSystemActivity(row("acc_backup", "company.backup", null))).toBe(true);
    expect(isSystemActivity(row("acc_account", "insert", null))).toBe(true);
  });

  it("is never a person's change to the books", () => {
    for (const [table, action] of [
      ["acc_journal_entry", "post"],
      ["acc_invoice", "void"],
      ["acc_bank_import_batch", "insert"],
      ["acc_bank_import_batch", "undo"],
      ["acc_statement_reconciliation", "post"],
      ["acc_cash_count", "insert"],
    ]) {
      expect(isSystemActivity(row(table, action)), `${table} ${action}`).toBe(false);
    }
  });

  it("is hidden until asked for", () => {
    const line = (id: string, system: boolean): ChangeLogEntry => ({
      id, at: "2026-10-01T10:00:00Z", who: "Example Person", what: "Updated", record: "Invoice", reference: null, detail: "", system,
    });
    const report = changeLog([line("a", false), line("b", true), line("c", true)]);
    expect(visibleChanges(report, false).lines.map((l) => l.id)).toEqual(["a"]);
    expect(visibleChanges(report, true).lines).toHaveLength(3);
  });
});

describe("actions read as words in the past tense", () => {
  it("names the actions that used to show their codes", () => {
    expect(ACTIVITY_VERBS.match_from_reconciliation).toBe("Matched by reconciliation");
    expect(ACTIVITY_VERBS.keep_statement_file).toBe("Statement file kept");
    expect(ACTIVITY_VERBS["company.backup"]).toBe("Backed up");
    // The stored code is British; the screen is not.
    expect(ACTIVITY_VERBS.uncategorise).toBe("Uncategorized");
  });
});
