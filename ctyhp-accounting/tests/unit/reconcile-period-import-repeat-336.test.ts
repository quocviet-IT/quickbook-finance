import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StatementLine } from "@/lib/domain/statement-import";
import type { StatementFigures } from "@/lib/domain/statement-proof";
import {
  NO_MARKS,
  newLines,
  newLinesLabel,
  statementDialogView,
  type StatementDialogInput,
} from "@/lib/domain/statement-import-dialog";
import {
  endsWithinReconciled,
  lastCompletedEnding,
  reconciledToNote,
  reconciledToRefusal,
} from "@/lib/domain/reconcile-period";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.36, from the controlled tests of 13 Nov 2026: a second reconciliation of
 * a month already reconciled is refused (migration 0197), and Import statement
 * says what is already here before it imports. Every bank, name and amount
 * here is invented.
 */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const migration = (file: string) => read("supabase", "migrations", file);
/** A function's body, as its last definition in a migration file has it. */
function body(text: string, name: string): string {
  const start = text.lastIndexOf(`create or replace function ${name}(`);
  const open = text.indexOf("$$", start) + 2;
  return text.slice(open, text.indexOf("$$;", open));
}
const norm = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
/** 0197's body less the one check it adds, to compare with the definition it replaces. */
const withoutGuard = (s: string) =>
  s
    .replace(/\n\s*-- (A period already signed off|Another reconciliation already signed off)[^\n]*\n\s*select max\(statement_ending_date\) into v_last[\s\S]*?end if;/, "")
    .replace(/; v_last date;/, ";");

describe("0197_reconcile_after_last_completed", () => {
  const sql = migration("0197_reconcile_after_last_completed.sql");
  const code = sql.replace(/--[^\n]*/g, "");
  const create = body(sql, "acc_create_reconciliation");
  const complete = body(sql, "acc_complete_reconciliation");

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("replaces the two functions and changes nothing else: no table, column or grant", () => {
    expect(code.match(/create or replace function/g)).toHaveLength(2);
    expect(code).not.toMatch(/\b(alter|drop|truncate|grant|revoke|create table|delete from)\b/i);
  });

  it("refuses a new reconciliation ending on or before the last completed one, before anything is written", () => {
    expect(create).toMatch(/if v_last is not null and p_ending_date <= v_last then\s+raise exception 'This account is already reconciled to %/);
    expect(create.indexOf("p_ending_date <= v_last")).toBeLessThan(create.indexOf("insert into acc_statement_reconciliation"));
    expect(create).toMatch(/status = 'completed';/);
  });

  it("refuses to complete one when another is completed to that date or later, before the difference is read", () => {
    expect(complete).toMatch(/status = 'completed' and id <> p_reconciliation_id;/);
    expect(complete).toMatch(/if v_last is not null and v_rec\.statement_ending_date <= v_last then/);
    expect(complete.indexOf("v_rec.statement_ending_date <= v_last")).toBeLessThan(complete.indexOf("acc_recon_cleared_total"));
  });

  it("is otherwise the definition each replaces: acc_create_reconciliation as 0026, acc_complete_reconciliation as 0169", () => {
    expect(norm(withoutGuard(create))).toBe(norm(body(migration("0026_bank_reconciliation_functions.sql"), "acc_create_reconciliation")));
    expect(norm(withoutGuard(complete))).toBe(norm(body(migration("0169_permissions_enforced.sql"), "acc_complete_reconciliation")));
  });

  it("leaves reopening alone: only the latest completed reconciliation can be reopened (0037)", () => {
    expect(body(migration("0037_access_control_functions.sql"), "acc_reopen_reconciliation")).toMatch(
      /statement_ending_date > v_rec\.statement_ending_date[\s\S]*A later completed reconciliation exists; reopen it first/,
    );
  });
});

describe("New reconciliation: the dates it cannot take", () => {
  const rows = [
    { status: "completed", statement_ending_date: "2026-09-30" },
    { status: "completed", statement_ending_date: "2026-10-31" },
    { status: "in_progress", statement_ending_date: "2026-11-30" },
  ];

  it("reads where the account is reconciled to from its completed reconciliations only", () => {
    expect(lastCompletedEnding(rows)).toBe("2026-10-31");
    expect(lastCompletedEnding([{ status: "in_progress", statement_ending_date: "2026-11-30" }])).toBeNull();
    expect(lastCompletedEnding([])).toBeNull();
  });

  it("refuses that date and any before it, and takes the day after", () => {
    expect(endsWithinReconciled("2026-10-31", "2026-10-31")).toBe(true);
    expect(endsWithinReconciled("2026-07-14", "2026-10-31")).toBe(true);
    expect(endsWithinReconciled("2026-11-01", "2026-10-31")).toBe(false);
    expect(endsWithinReconciled("2026-01-31", null)).toBe(false);
  });

  it("says where the account is reconciled to", () => {
    expect(reconciledToNote("2026-10-31")).toBe("Reconciled to 10/31/2026. The statement must end after that date.");
    expect(reconciledToRefusal("2026-10-31")).toBe(
      "This account is already reconciled to 10/31/2026. Choose a statement that ends after that date.",
    );
  });

  it("is wired into the dialog: greyed-out dates, the note, and the same refusal for a typed date", () => {
    const screen = read("app", "(app)", "banking", "reconcile", "ReconcileListClient.tsx");
    expect(screen).toContain("const reconciledTo = lastCompletedEnding(shownRows);");
    expect(screen).toContain('disabledDate={(day) => endsWithinReconciled(day.format("YYYY-MM-DD"), reconciledTo)}');
    expect(screen).toContain("extra={reconciledTo ? reconciledToNote(reconciledTo) : undefined}");
    expect(screen).toContain("Promise.reject(new Error(reconciledToRefusal(reconciledTo)))");
  });
});

const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});
/** An invented statement: opening $1,000.00, three lines, closing $1,180.00. */
const LINES = [line("2026-03-02", 50000, "DEPOSIT"), line("2026-03-09", -30000, "RENT"), line("2026-03-20", -2000, "SERVICE FEE")];
const PRINTED: StatementFigures = { openingMinor: 100000, closingMinor: 118000, start: "2026-03-01", end: "2026-03-31" };
const view = (over: Partial<StatementDialogInput> = {}) =>
  statementDialogView(
    {
      purpose: "import",
      kind: "pdf",
      lines: LINES,
      figures: PRINTED,
      prior: null,
      marks: NO_MARKS,
      check: { present: [], otherSource: [] },
      accounts: { here: "Example Bank · 1087", labels: {} },
      canOverride: false,
      onlyNewLines: true,
      ...over,
    },
    money,
  );

describe("Import statement: what is already here, said before the import", () => {
  it("a statement imported before: says so, offers nothing, and cannot be sent", () => {
    const v = view({ check: { present: [0, 1, 2], otherSource: [] } });
    expect(v.alreadyHere).toEqual({
      nothingNew: true,
      text: "Every line of this statement is already in Bank Transactions for Example Bank · 1087, from an earlier import of it. There is nothing new to import.",
    });
    expect(v.okLabel).toBe("Nothing new to import");
    expect(v.okDisabled).toBe(true);
  });

  it("part of it here: counts only the new lines", () => {
    const v = view({ check: { present: [0], otherSource: [] } });
    expect(v.alreadyHere).toEqual({
      nothingNew: false,
      text: "1 of 3 lines is already in Bank Transactions for Example Bank · 1087, from an earlier import of this statement, and is not imported again.",
    });
    expect(v.okLabel).toBe("Import 2 new lines");
    expect(v.okDisabled).toBe(false);
  });

  it("nothing here: unchanged", () => {
    const v = view();
    expect(v.alreadyHere).toBeNull();
    expect(v.okLabel).toBe("Import 3 lines");
    expect(v.okDisabled).toBe(false);
  });

  it("says nothing until the server has said which lines are here", () => {
    const v = view({ check: null });
    expect(v.alreadyHere).toBeNull();
    expect(v.checking).toBe(true);
    expect(v.okDisabled).toBe(true);
  });

  it("in a reconciliation (onlyNewLines off) the statement is still imported to pair its lines", () => {
    const v = view({ onlyNewLines: undefined, check: { present: [0, 1, 2], otherSource: [] } });
    expect(v.alreadyHere).toBeNull();
    expect(v.okLabel).toBe("Import 3 lines");
    expect(v.okDisabled).toBe(false);
  });

  it("counts lines ticked Not a transaction as neither new nor already here", () => {
    expect(newLines(3, new Set([2]), [0], [])).toEqual({ count: 1, alreadyHere: 1, counted: 2 });
    expect(newLines(3, new Set(), [], [1])).toEqual({ count: 2, alreadyHere: 0, counted: 3 });
    expect(newLinesLabel(1)).toBe("Import 1 new line");
    expect(newLinesLabel(0)).toBe("Nothing new to import");
  });

  it("is on in Banking's dialog only, and drawn above the lines", () => {
    const banking = read("app", "(app)", "banking", "BankingClient.tsx");
    const workspace = read("app", "(app)", "banking", "reconcile", "[id]", "ReconcileWorkspaceClient.tsx");
    const modal = read("app", "(app)", "banking", "ImportStatementModal.tsx");
    const preview = read("app", "(app)", "banking", "StatementLinesPreview.tsx");
    expect(banking).toMatch(/<ImportStatementModal[\s\S]*?onlyNewLines[\s\S]*?\/>/);
    expect(workspace).not.toContain("onlyNewLines");
    expect(modal).toContain("onlyNewLines = false,");
    expect(modal).toMatch(/canOverride,\s+onlyNewLines,\s+\}/);
    expect(preview).toContain("view.alreadyHere ? (");
  });
});

describe("where people read about it", () => {
  it("is the newest release", () => {
    expect(RELEASES[0].version).toBe("3.0.36");
    expect(RELEASES[0].changes.map((c) => c.title)).toEqual([
      "A second reconciliation for a month already reconciled is refused",
      "Import statement counts only the lines that are new",
    ]);
  });
});
