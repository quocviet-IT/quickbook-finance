import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AddMissingBox from "@/app/(app)/banking/reconcile/[id]/AddMissingBox";
import DifferenceAlert from "@/app/(app)/banking/reconcile/[id]/DifferenceAlert";
import StandingTag from "@/app/(app)/banking/reconcile/StandingTag";
import {
  ADD_MISSING_ELASTIC_FLOOR,
  ADD_MISSING_MIN_WIDTH,
  ADD_MISSING_WIDTH,
  LEDGER_LINE_ELASTIC_FLOOR,
  LEDGER_LINE_WIDTH,
  LEDGER_LINES_MIN_WIDTH,
  STATEMENT_LINE_ELASTIC_FLOOR,
  STATEMENT_LINE_WIDTH,
  STATEMENT_LINES_MIN_WIDTH,
  STATEMENT_LINES_READ_MIN_WIDTH,
} from "@/app/(app)/banking/reconcile/[id]/statement-line-columns";
import {
  HISTORY_COLUMN_WIDTH,
  HISTORY_ELASTIC_FLOOR,
  HISTORY_MIN_WIDTH,
  HISTORY_SHORT_DATE,
  HISTORY_STATE_TONES,
} from "@/app/(app)/banking/reconcile/history/history-columns";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { TONES } from "@/lib/design/tone";
import {
  ADD_ANYWAY,
  EXTRA_LINE_NOTE,
  EXTRA_LINE_TAG,
  HELD_BACK_HEADING,
  duplicateNote,
  type AddItem,
  type AddMissingPlan,
  type HeldLine,
} from "@/lib/domain/add-missing";
import { explainDifference, type DifferenceExplained } from "@/lib/domain/reconcile-difference";
import { HISTORY_STATE_LABELS, RECONCILE_HISTORY, RECONCILE_HISTORY_PATH } from "@/lib/domain/reconcile-history";
import { DISCARD_CONFIRMATION, SET_ASIDE_MESSAGE, reconciliationStandings } from "@/lib/domain/reconcile-statement";
import { STATEMENT_READING_NOTE } from "@/lib/domain/pdf-statement-view";

/**
 * The screens of 2.03, "Reconciliation history and flow fixes": the
 * reconciliation workspace (bring the history forward, discard, the difference
 * in parts, Not a transaction / Restore, Extra lines), Add missing lines'
 * held-back lines with Add anyway, the new Reconcile history page, and the
 * import dialog's note. The components that draw from data are rendered; the
 * wiring to the server actions is read from the source, as the other
 * statement-screen contracts do. Every figure is invented.
 */

const ROOT = process.cwd();
const RECONCILE = join(ROOT, "app", "(app)", "banking", "reconcile");
/** A source file, its line endings as the repository keeps them: a Windows checkout writes CRLF. */
const read = (...parts: string[]) => readFileSync(join(RECONCILE, ...parts), "utf8").replace(/\r\n/g, "\n");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

/** The text of a rendered component, tags stripped, so a test reads what a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** A stylesheet's phone rules: everything from its `@media (max-width: 640px)`. */
function phoneRules(css: string): string {
  const at = css.indexOf("@media (max-width: 640px)");
  expect(at, "no phone rules").toBeGreaterThan(-1);
  return css.slice(at);
}

/** One rule's body, from its selector to its closing brace. */
function ruleOf(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

/** A function's body: from its declaration to the first line that closes it at the given indent. */
function body(source: string, start: string, close = "\n  };\n"): string {
  const at = source.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  const end = source.indexOf(close, at);
  expect(end, `${start} has no end`).toBeGreaterThan(at);
  return source.slice(at, end);
}

// --- Add missing lines, with lines held back ---------------------------------

const item = (lineNo: number, description: string, amountMinor: number): AddItem => ({
  lineNo,
  txnDate: "2026-07-28",
  description,
  amountMinor,
  transactionId: `t-${lineNo}`,
  accountId: `acct-${lineNo}`,
  accountLabel: "6400 — Bank Charges",
  source: "rule",
  short: "Rule 1",
  why: "Rule 1: SERVICE FEE",
});
const held = (base: AddItem, reason: HeldLine["reason"], note: string): HeldLine => ({ ...base, reason, note, matches: [] });
const plan = (items: AddItem[], heldLines: HeldLine[]): AddMissingPlan => ({
  missing: items.length + heldLines.length,
  items,
  held: heldLines,
  cannot: [],
  uncategorized: 0,
  blocked: null,
});
const duplicate = duplicateNote([{ journalLineId: "jl-1", entryId: "e-1", entryNumber: "JE-000310", entryDate: "2026-07-27" }]);

function renderBox(p: AddMissingPlan, withAddAnyway = true): string {
  return renderToString(
    createElement(AddMissingBox, {
      plan: p,
      bankAccountId: "bank-1",
      money,
      adding: false,
      onAdd: () => {},
      ...(withAddAnyway ? { onAddAnyway: () => {}, addingLine: null } : {}),
    }),
  );
}

describe("Add missing lines: the lines held back", () => {
  const shop = item(2, "POS EXAMPLE SHOP", -4200);
  const fee = item(3, "SERVICE FEE", -1500);
  const wire = item(4, "INCOMING WIRE", 3000);

  it("lists each held line with its date, description, amount, note and its own Add anyway", () => {
    const out = text(renderBox(plan([wire], [held(shop, "duplicate", duplicate), held(fee, "extra", EXTRA_LINE_NOTE)])));
    expect(out).toContain(HELD_BACK_HEADING);
    expect(out).toContain("Jul 28, 2026 · POS EXAMPLE SHOP · -$42.00");
    expect(out).toContain("Looks like JE-000310 already in the books.");
    expect(out).toContain("Jul 28, 2026 · SERVICE FEE · -$15.00");
    expect(out).toContain(EXTRA_LINE_NOTE);
    expect(out.split(ADD_ANYWAY).length - 1).toBe(2);
  });

  it("keeps Add all N to what it adds: the lines that are not held back", () => {
    const out = text(renderBox(plan([wire], [held(shop, "duplicate", duplicate)])));
    expect(out).toContain("Add all 1 to the books");
    expect(out).toContain("The bank shows 2 things your books do not.");
  });

  it("still shows the box, with the held lines and no Add all, when every missing line is held back", () => {
    const out = text(renderBox(plan([], [held(shop, "extra", EXTRA_LINE_NOTE), held(fee, "extra", EXTRA_LINE_NOTE)])));
    expect(out).toContain("The bank shows 2 things your books do not.");
    expect(out).toContain("POS EXAMPLE SHOP");
    expect(out).not.toMatch(/Add all \d/);
    expect(out.split(ADD_ANYWAY).length - 1).toBe(2);
  });

  it("offers Add anyway only to someone who may add", () => {
    const out = text(renderBox(plan([], [held(shop, "extra", EXTRA_LINE_NOTE)]), false));
    expect(out).toContain("POS EXAMPLE SHOP");
    expect(out).not.toContain(ADD_ANYWAY);
  });

  it("is wired to post one held line alone, chosen with Add anyway, and Add all to post only its own lines", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    const anyway = body(workspace, "async function addAnyway(", "\n  }\n");
    expect(anyway).toContain(
      "addMissingLinesAction(reconciliationId, [{ lineNo: line.lineNo, accountId: line.accountId }], [line.lineNo])",
    );
    const all = body(workspace, "async function addAll(", "\n  }\n");
    expect(all).toContain("shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId }))");
    expect(all).not.toMatch(/held|anyway/i);
    expect(workspace).toContain("onAddAnyway={(line) => void addAnyway(line)}");
  });
});

// --- The workspace's statement lines ------------------------------------------

describe("the statement lines table", () => {
  it("fits the 984px box of a 1280px window with the line's action, Description at its floor", () => {
    expect(STATEMENT_LINE_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    const measured = sum(Object.values(STATEMENT_LINE_WIDTH));
    expect(fitsBox(measured, STATEMENT_LINE_ELASTIC_FLOOR)).toBe(true);
    expect(measured + STATEMENT_LINE_ELASTIC_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
    expect(STATEMENT_LINE_WIDTH.date).toBe(COLUMN.DATE);
  });

  it("draws every measured width it adds up, with no sideways scroll", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    for (const key of Object.keys(STATEMENT_LINE_WIDTH)) expect(workspace, key).toContain(`width: SW.${key}`);
    expect(workspace).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
  });

  it("keeps every column of the workspace's tables reachable on a phone: measured widths plus floors", () => {
    expect(STATEMENT_LINES_MIN_WIDTH).toBe(sum(Object.values(STATEMENT_LINE_WIDTH)) + STATEMENT_LINE_ELASTIC_FLOOR);
    expect(STATEMENT_LINES_READ_MIN_WIDTH).toBe(STATEMENT_LINES_MIN_WIDTH - STATEMENT_LINE_WIDTH.aside);
    expect(LEDGER_LINES_MIN_WIDTH).toBe(sum(Object.values(LEDGER_LINE_WIDTH)) + LEDGER_LINE_ELASTIC_FLOOR);
    expect(ADD_MISSING_MIN_WIDTH).toBe(sum(Object.values(ADD_MISSING_WIDTH)) + ADD_MISSING_ELASTIC_FLOOR);
    for (const floor of [STATEMENT_LINE_ELASTIC_FLOOR, LEDGER_LINE_ELASTIC_FLOOR, ADD_MISSING_ELASTIC_FLOOR]) {
      expect(floor).toBe(COLUMN.TEXT_MIN);
    }
    // The figures the stylesheet draws with are these.
    const phone = phoneRules(read("[id]", "workspace.module.css"));
    const minWidth = (selector: string) => ruleOf(phone, `${selector} :global(.ant-table-content) > table`);
    expect(minWidth(".statementLines")).toContain(`min-width: ${STATEMENT_LINES_READ_MIN_WIDTH}px;`);
    expect(minWidth(".statementLines.withAction")).toContain(`min-width: ${STATEMENT_LINES_MIN_WIDTH}px;`);
    expect(minWidth(".ledgerLines")).toContain(`min-width: ${LEDGER_LINES_MIN_WIDTH}px;`);
    expect(minWidth(".addMissing")).toContain(`min-width: ${ADD_MISSING_MIN_WIDTH}px;`);
  });

  it("scrolls Ant Design's own tables inside their box on a phone, and changes nothing at 1280", () => {
    const css = read("[id]", "workspace.module.css");
    // A raw Table's content box scrolls sideways only with scroll.x, which these tables never set.
    expect(phoneRules(css)).toContain(
      ".statementLines :global(.ant-table-content),\n  .ledgerLines :global(.ant-table-content) {\n    overflow-x: auto;",
    );
    // Every rule is a phone rule: nothing outside the media query.
    expect(css.slice(0, css.indexOf("@media"))).not.toContain("{");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
  });

  it("puts each table under its phone rule, the statement lines' action column with its own", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).toContain(
      "className={writing ? `${styles.statementLines} ${styles.withAction}` : styles.statementLines}",
    );
    // The action column is drawn on exactly the same condition.
    expect(workspace).toContain("...(writing\n");
    expect(workspace).toContain("className={styles.ledgerLines}");
    const box = read("[id]", "AddMissingBox.tsx");
    expect(box).toContain("className={styles.addMissing}");
    for (const key of Object.keys(ADD_MISSING_WIDTH)) expect(box, key).toContain(`width: AW.${key}`);
  });

  it("offers Not a transaction and Restore only to a writer while in progress, through the server's action", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).toContain('const inProgress = detail?.status === "in_progress";');
    expect(workspace).toContain("const writing = canWrite && inProgress;");
    const column = workspace.slice(workspace.indexOf("...(writing"), workspace.indexOf(": []),"));
    expect(column).toContain("asideActionFor(standingOf.get(line.lineNo))");
    expect(column).toContain("setAside(line.lineNo, action.aside)");
    const setAside = body(workspace, "async function setAside(", "\n  }\n");
    expect(setAside).toContain("setStatementLineAsideAction(reconciliationId, { line_no: lineNo, aside })");
    expect(setAside).toContain("message.error(res.error");
  });

  it("says a line set aside stays in Bank Transactions, and keeps its button busy until the lines are read again", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    const setAside = body(workspace, "async function setAside(", "\n  }\n");
    const said = setAside.indexOf("if (aside) message.success(SET_ASIDE_MESSAGE, 8);");
    expect(said).toBeGreaterThan(setAside.indexOf("setStatementLineAsideAction("));
    const reread = setAside.indexOf("await load();");
    expect(reread).toBeGreaterThan(said);
    expect(setAside.indexOf("setAsideLine(null);")).toBeGreaterThan(reread);
    expect(SET_ASIDE_MESSAGE).toBe(
      "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.",
    );
  });

  it("marks a line held back as extra beside its standing, and reads a line set aside as Not a transaction", () => {
    expect(read("[id]", "ReconcileWorkspaceClient.tsx")).toContain("extra={extraLines.has(line.lineNo)}");
    const extra = text(renderToString(createElement(StandingTag, { standing: { kind: "missing" }, extra: true })));
    expect(extra).toBe(`Not in the books ${EXTRA_LINE_TAG}`);
    expect(renderToString(createElement(StandingTag, { standing: { kind: "missing" }, extra: true }))).toContain(
      `title="${EXTRA_LINE_NOTE}"`,
    );
    expect(text(renderToString(createElement(StandingTag, { standing: { kind: "missing" } })))).toBe("Not in the books");
    expect(text(renderToString(createElement(StandingTag, { standing: { kind: "aside" }, extra: true })))).toBe("Not a transaction");
  });
});

// --- The difference, explained ----------------------------------------------

describe("the difference, explained", () => {
  const renderParts = (explained: DifferenceExplained) => text(renderToString(createElement(DifferenceAlert, { explained, money })));

  it("lists the opening, each line part with its count, and what is left, with the hint below", () => {
    const out = renderParts({
      differenceMinor: 512340 - 4200 + 1500 - 10000,
      opening: {
        beginningMinor: 0,
        openingMinor: 512340,
        amountMinor: 512340,
        text: "This reconciliation begins at $0.00; the statement opens at $5123.40.",
      },
      onStatement: { count: 2, amountMinor: -4200 + 1500, ids: [2, 3] },
      tickedNotOnStatement: { count: 1, amountMinor: 10000, ids: ["jl-9"] },
      leftMinor: 0,
      hint: null,
    });
    expect(out).toContain("The difference of $4996.40, explained");
    expect(out).toContain("Opening $5123.40");
    expect(out).toContain("This reconciliation begins at $0.00; the statement opens at $5123.40.");
    expect(out).toContain("On the statement, not in the books · 2 lines -$27.00");
    expect(out).toContain("Ticked here, not on the statement · 1 line $100.00");
    expect(out).toContain("Left to explain $0.00");
  });

  it("hides a line part with nothing in it, always shows what is left, and names the line that equals it", () => {
    const out = renderParts({
      differenceMinor: 1500,
      opening: null,
      onStatement: { count: 0, amountMinor: 0, ids: [] },
      tickedNotOnStatement: { count: 0, amountMinor: 0, ids: [] },
      leftMinor: 1500,
      hint: "It equals JE-000123 of Sep 5, 2026 ($15.00). Check that one first.",
    });
    expect(out).not.toContain("Opening");
    expect(out).not.toContain("On the statement, not in the books");
    expect(out).not.toContain("Ticked here, not on the statement");
    expect(out).toContain("Left to explain $15.00");
    expect(out).toContain("It equals JE-000123 of Sep 5, 2026 ($15.00). Check that one first.");
  });

  it("draws what explainDifference works out from the workspace's own objects", () => {
    // Opening $1,000.00; the books begin at 0. The deposit pairs and is ticked; the fee is not in the books.
    const statement = {
      endingDate: "2026-07-31",
      openingMinor: 100000,
      lines: [
        { lineNo: 0, txnDate: "2026-07-05", description: "DEPOSIT", reference: null, amountMinor: 50000, setAside: false },
        { lineNo: 1, txnDate: "2026-07-30", description: "SERVICE FEE", reference: null, amountMinor: -1500, setAside: false },
      ],
    };
    const book = [
      { journalLineId: "jl-1", entryId: "e-1", entryNumber: "JE-000101", entryDate: "2026-07-05", signedMinor: 50000, cleared: true, reference: null },
    ];
    const standings = reconciliationStandings(statement, book).standings;
    const explained = explainDifference(
      {
        detail: { beginningMinor: 0, clearedTotalMinor: 50000, statementEndingMinor: 148500, differenceMinor: 98500 },
        statement,
        standings,
        book,
      },
      money,
    );
    expect(explained).not.toBeNull();
    const out = renderParts(explained!);
    expect(out).toContain("Opening $1000.00");
    expect(out).toContain("On the statement, not in the books · 1 line -$15.00");
    expect(out).not.toContain("Ticked here, not on the statement");
    expect(out).toContain("Left to explain $0.00");
  });

  it("replaces Unexplained difference and keeps the zero message exactly", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).not.toContain("Unexplained difference");
    expect(workspace).toContain('<Alert type="success" message="Difference is zero — ready to complete." />');
    expect(workspace).toContain("<DifferenceAlert explained={explained} money={money} />");
    expect(workspace).toContain("explainDifference(");
  });

  it("uses no colour of its own, so the dark theme follows", () => {
    for (const file of ["DifferenceAlert.tsx", "difference.module.css"]) {
      const source = read("[id]", file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
    }
  });
});

// --- Bringing the history forward, and discarding -----------------------------

describe("the workspace's bring forward and discard", () => {
  const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");

  it("reads the offer alongside the figures, and words it while in progress only", () => {
    expect(workspace).toMatch(/void load\(\);\s*void loadHistory\(\);\s*\}, \[load, loadHistory\]\);/);
    expect(workspace).toContain("sessionHistoryAdviceAction(reconciliationId)");
    expect(workspace).toContain("const historyAdvice = inProgress ? sessionHistoryAdvice(historyFacts, money) : null;");
  });

  it("shows the button only to a writer, only when the books agree with the opening", () => {
    expect(workspace).toContain('type={historyAdvice.canBringForward ? "info" : "warning"}');
    expect(workspace).toMatch(/historyAdvice\.canBringForward && writing \? \(\s*<Button[^>]*onClick=\{\(\) => bringHistoryForward\(/);
  });

  it("asks first, counting the entries, then says how many and any file warning", () => {
    const bring = body(workspace, "const bringHistoryForward = (");
    expect(bring).toContain("content: bringHistoryForwardConfirmation(entries, facts.through)");
    expect(bring).toContain("bringHistoryForwardFromSessionAction(reconciliationId)");
    expect(bring).toContain("historyBroughtForwardMessage(r.data.lines, facts.through, rebased, money)");
    expect(bring).toContain("if (r.data.fileWarning) message.warning(r.data.fileWarning, 10);");
  });

  it("hides the old opening warning while the offer speaks", () => {
    expect(workspace).toContain("{opening && !completed && !historyAdvice ? <Alert");
  });

  it("takes the offer away the moment the history is brought forward, and cannot send it twice", () => {
    const bring = body(workspace, "const bringHistoryForward = (");
    expect(bring).toContain("if (bringing) return;\n    setBringing(true);");
    expect(bring).toContain("afterClose: () => setBringing(false),");
    // The figures and the offer are read again before the dialog closes and the
    // toast shows, so the spent offer never shows beside the old figures, and
    // clearing the offer alone would bring back the opening warning drawn from them.
    const reread = bring.indexOf("await Promise.all([load(), loadHistory()]);");
    expect(reread).toBeGreaterThan(bring.indexOf("throw new Error(r.error);"));
    expect(reread).toBeLessThan(bring.indexOf("message.success(historyBroughtForwardMessage("));
    expect(bring).not.toContain("setHistoryFacts(null);");
    expect(workspace).toMatch(/loading=\{bringing\}\s*onClick=\{\(\) => bringHistoryForward\(/);
  });

  it("offers Discard only to a writer while in progress", () => {
    expect(workspace).toMatch(/\{writing \? \(\s*<Button danger loading=\{discarding\} onClick=\{discard\}>\s*\{DISCARD_RECONCILIATION\}/);
  });

  it("keeps Discard busy from its click, and once discarded, until the screen has left", () => {
    const discard = body(workspace, "const discard = () => {");
    expect(discard).toContain("if (discarding) return;");
    expect(discard).toContain("setDiscarding(true);");
    expect(discard).toContain("if (!discarded) setDiscarding(false);");
    const done = discard.indexOf("discarded = true;");
    expect(done).toBeGreaterThan(discard.indexOf("discardReconciliationAction(reconciliationId"));
    expect(done).toBeLessThan(discard.indexOf("router.push("));
  });

  it("keeps Complete, Record adjustment and Reopen busy until the figures are read again", () => {
    const complete = body(workspace, "const complete = async () => {");
    expect(complete).toContain("if (completing) return;\n    setCompleting(true);");
    expect(complete.indexOf("await load();")).toBeGreaterThan(complete.indexOf("completeReconciliationAction("));
    expect(complete).toContain("} finally {\n      setCompleting(false);");
    expect(workspace).toMatch(/loading=\{completing\}/);

    const adjust = body(workspace, "const submitAdjust = async () => {");
    expect(adjust).toContain("if (adjusting) return;");
    expect(adjust.indexOf("await load();")).toBeGreaterThan(adjust.indexOf("recordAdjustmentAction("));
    expect(adjust).toContain("} finally {\n      setAdjusting(false);");
    expect(workspace).toContain("confirmLoading={adjusting}");

    const reopen = body(workspace, "const reopen = () => {");
    expect(reopen).toContain("if (reopening) return;\n    setReopening(true);");
    expect(reopen).toContain("afterClose: () => setReopening(false),");
    expect(reopen).toContain("await load();");
    expect(workspace).toContain("<Button danger loading={reopening} onClick={reopen}>");
  });

  it("requires a reason: the button starts disabled, and nothing is sent without one", () => {
    const discard = body(workspace, "const discard = () => {");
    expect(discard).toContain("{DISCARD_CONFIRMATION}");
    expect(discard).toContain("okButtonProps: { danger: true, disabled: true }");
    expect(discard).toContain("dialog.update({ okButtonProps: { danger: true, disabled: reasonProblem(reason) !== null } })");
    const check = discard.indexOf("const problem = reasonProblem(reason);");
    const send = discard.indexOf("discardReconciliationAction(reconciliationId, { reason: reason.trim() })");
    expect(check).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(check);
    expect(discard.slice(check, send)).toContain("throw new Error(problem);");
    expect(DISCARD_CONFIRMATION).toBe(
      "Its ticks are removed. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.",
    );
  });

  it("returns to Reconcile with the router once discarded", () => {
    expect(body(workspace, "const discard = () => {")).toContain("router.push(discardedReturnPath(bankAccount.id));");
  });
});

// --- Reconcile history -----------------------------------------------------------

describe("the Reconcile history page", () => {
  const page = read("history", "page.tsx");
  const client = read("history", "ReconcileHistoryClient.tsx");

  it("is a route, a thin server shell with no Ant Design, linked back to Reconcile", () => {
    expect(existsSync(join(RECONCILE, "history", "page.tsx"))).toBe(true);
    expect(RECONCILE_HISTORY_PATH).toBe("/banking/reconcile/history");
    expect(page).not.toMatch(/^\s*["']use client["']/);
    expect(page).not.toMatch(/from ["']antd["']/);
    expect(page).toContain("<PageHeader");
    expect(page).toContain("title={RECONCILE_HISTORY}");
    expect(page).toContain('<Link href="/banking/reconcile">← Bank Reconciliation</Link>');
    expect(page).toContain("today={asOf}");
  });

  it("is linked from the Reconcile start screen", () => {
    expect(read("ReconcileListClient.tsx")).toContain("<Link href={RECONCILE_HISTORY_PATH}>{RECONCILE_HISTORY}</Link>");
    expect(RECONCILE_HISTORY).toBe("Reconcile history");
  });

  it("draws one row per account through DataTable, from the history action", () => {
    expect(client).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(client).toMatch(/<DataTable<HistoryAccount>/);
    expect(client).not.toMatch(/<Table(?!\w)/);
    expect(client).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
    expect(client).not.toMatch(/pageSize:\s*\d/);
    expect(client).toContain("reconciliationHistoryAction()");
    for (const title of ["Account", "Lines not reconciled", "From", "To", "Last reconciled", "State"]) {
      expect(client, title).toContain(`title: "${title}"`);
    }
  });

  it("fits the 984px box of a 1280px window, Account at its floor", () => {
    expect(HISTORY_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(HISTORY_COLUMN_WIDTH)), HISTORY_ELASTIC_FLOOR)).toBe(true);
    expect(HISTORY_COLUMN_WIDTH.choose).toBe(COLUMN.SELECTION);
    expect(HISTORY_COLUMN_WIDTH.from).toBe(HISTORY_SHORT_DATE);
    expect(HISTORY_COLUMN_WIDTH.to).toBe(HISTORY_SHORT_DATE);
    // "Sep 30, 2026" is wider than the 2026-09-30 the date token measures, and fits Last reconciled too.
    expect(HISTORY_SHORT_DATE).toBeGreaterThan(COLUMN.DATE);
    expect(HISTORY_COLUMN_WIDTH.lastReconciled).toBeGreaterThanOrEqual(HISTORY_SHORT_DATE);
    expect(client).toContain("columnWidth: W.choose");
    for (const key of Object.keys(HISTORY_COLUMN_WIDTH).filter((k) => k !== "choose")) {
      expect(client, key).toContain(`width: W.${key}`);
    }
  });

  it("prints its dates as its card does, Sep 30, 2026", () => {
    for (const [title, field, width] of [
      ["From", "firstOpenDate", "W.from"],
      ["To", "lastOpenDate", "W.to"],
      ["Last reconciled", "lastReconciledDate", "W.lastReconciled"],
    ]) {
      expect(client, title).toContain(`{ title: "${title}", dataIndex: "${field}", width: ${width}, render: historyDateCell }`);
    }
    expect(client).toContain('(iso ? <time dateTime={iso}>{shortDate(iso, true)}</time> : "—")');
    expect(client).not.toContain("dateColumn");
  });

  it("keeps Account's name and number on a phone: measured widths plus its floor, scrolled inside the table's box", () => {
    expect(HISTORY_MIN_WIDTH).toBe(sum(Object.values(HISTORY_COLUMN_WIDTH)) + HISTORY_ELASTIC_FLOOR);
    const css = read("history", "history.module.css");
    expect(ruleOf(phoneRules(css), ".history :global(.ant-table-content) > table")).toContain(`min-width: ${HISTORY_MIN_WIDTH}px;`);
    // DataTable's content box already scrolls sideways (globals.css), so the page does not.
    expect(readFileSync(join(ROOT, "app", "globals.css"), "utf8")).toMatch(
      /\.accounting-table--fit \.ant-table-content,\s*\.accounting-table--fit \.ant-table-body \{\s*overflow-x: auto;/,
    );
    expect(client).toContain("<div className={styles.history}>");
  });

  it("marks the chosen account with a light wash rather than the heavy default fill, from the theme's tokens", () => {
    const css = read("history", "history.module.css");
    // Doubled, so it outranks Ant Design's own rule, as Review import does.
    expect(css).toContain(
      ".history.history :global(.ant-table-tbody > tr.ant-table-row-selected > td.ant-table-cell) {\n  background: var(--ob-accent-wash);",
    );
    expect(css).toContain(
      ".history.history :global(.ant-table-tbody > tr.ant-table-row-selected:hover > td.ant-table-cell) {\n  background: var(--ob-surface-subtle);",
    );
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
  });

  it("cannot send Bring forward twice, and clears the form at once when it is done", () => {
    const bring = body(client, "function bringForward(", "\n  }\n");
    expect(bring).toContain("if (!shown.action || bringing) return;\n    setBringing(true);");
    expect(bring).toContain("afterClose: () => setBringing(false),");
    expect(bring.indexOf("setThrough(null);")).toBeGreaterThan(bring.indexOf("throw new Error(r.error);"));
    expect(bring.indexOf("setThrough(null);")).toBeLessThan(bring.indexOf("void load();"));
    expect(client).toMatch(/loading=\{bringing\}\s*onClick=\{\(\) => bringForward\(/);
  });

  it("reads each state in its own word, on the shared tones", () => {
    expect(HISTORY_STATE_TONES.never).toEqual({ tone: "warning", label: HISTORY_STATE_LABELS.never });
    expect(HISTORY_STATE_TONES.reconciled).toEqual({ tone: "positive", label: HISTORY_STATE_LABELS.reconciled });
    for (const state of Object.values(HISTORY_STATE_TONES)) expect(TONES).toContain(state.tone);
  });

  it("cannot choose a date after the company's today", () => {
    expect(client).toContain('disabledDate={(day) => day.format("YYYY-MM-DD") > today}');
  });

  it("reads the books once the date settles, for the account and date asked, and words it with historyAdvice", () => {
    expect(client).toContain("window.setTimeout(");
    expect(client).toContain("PREVIEW_DELAY_MS");
    expect(client).toContain("historyPreviewAction({ bank_account_id: chosenId, through: throughIso })");
    expect(client).toContain("preview.key === previewKey");
    expect(client).toContain("historyAdvice(chosen, throughIso, balanceMinor, shownPreview, money)");
  });

  it("offers Bring forward N entries only to a writer, on a match, after asking", () => {
    expect(client).toMatch(/advice\.action && canWrite && throughIso && balanceMinor !== null \? \(\s*<Button/);
    const bring = body(client, "function bringForward(", "\n  }\n");
    expect(bring).toContain("content: bringHistoryForwardConfirmation(shown.entries, date)");
    expect(bring).toContain("bringHistoryForwardAction({");
    expect(bring).toContain("historyBroughtForwardMessage(r.data.lines, date, rebased, money)");
  });

  it("sends a session in the way to that session, and says Reconciled up to on an account already reconciled", () => {
    expect(client).toContain('advice?.kind === "inProgress" && advice.inProgressId');
    expect(client).toContain("<Link href={`/banking/reconcile/${advice.inProgressId}`}>{OPEN_IN_PROGRESS}</Link>");
    expect(client).toContain("reconciledUpTo(chosen.lastReconciledDate)");
    expect(client).toContain('advice?.kind === "out"');
  });
});

// --- The Guide -------------------------------------------------------------------

describe("the Guide's reconcile steps", () => {
  const steps = GUIDE_FLOWS.flatMap((flow) => flow.steps);
  const note = (action: string) => {
    const step = steps.find((s) => s.action === action);
    expect(step, action).toBeDefined();
    return step?.note ?? "";
  };

  it("words Complete's rule as the screen does: the difference in its parts, zero or a recorded adjustment", () => {
    for (const step of steps) expect(step.note ?? "", step.action).not.toMatch(/unexplained difference/i);
    const reconcile = note("Reconcile to a statement balance");
    expect(reconcile).toContain("The difference is explained in its parts");
    expect(reconcile).toContain("Complete needs a difference of zero or a recorded adjustment somebody signs for.");
  });

  it("says a line set aside stays in Bank Transactions", () => {
    expect(note("Set aside a statement line that is not a transaction")).toContain(
      "its line stays in Bank Transactions, to exclude there if it is not real",
    );
  });

  it("says when a single line is Extra beside a line that is really missing", () => {
    expect(note("Add a line held back from Add all")).toContain(
      "When it does not add up and exactly one of them is the amount it is out by, that one alone is Extra.",
    );
  });
});

// --- The import dialog -----------------------------------------------------------

describe("the statement import dialog", () => {
  it("says which files are read exactly and which can be misread, wherever it is opened from", () => {
    const modal = readFileSync(join(ROOT, "app", "(app)", "banking", "ImportStatementModal.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(modal).toContain("{STATEMENT_READING_NOTE}");
    // Not tied to a prop: every caller's dialog says it.
    expect(modal).not.toMatch(/\w+ \? \(?\s*<Typography\.Text[^>]*>\s*\{STATEMENT_READING_NOTE\}/);
    expect(STATEMENT_READING_NOTE).toBe(
      "A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread.",
    );
  });
});
