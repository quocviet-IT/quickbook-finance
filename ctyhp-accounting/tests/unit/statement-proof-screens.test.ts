import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatementProofPanel from "@/app/(app)/banking/StatementProofPanel";
import StatementLinesPreview from "@/app/(app)/banking/StatementLinesPreview";
import {
  IMPORT_DIALOG_BOX,
  IMPORT_DIALOG_WIDTH,
  IMPORT_PREVIEW_ELASTIC_FLOOR,
  IMPORT_PREVIEW_MIN_WIDTH,
  IMPORT_PREVIEW_WIDTH,
} from "@/app/(app)/banking/import-preview-columns";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { RELEASES } from "@/lib/domain/changelog";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  NOT_A_TRANSACTION,
  NO_MARKS,
  OTHER_SOURCE_NOTE,
  confirmStatement,
  statementDialogView,
  type DialogMarks,
  type StatementDialogInput,
  type StatementDialogView,
} from "@/lib/domain/statement-import-dialog";
import { PROOF_REFUSAL, PROOF_TEXT, type StatementFigures } from "@/lib/domain/statement-proof";
import { OTHER_SOURCE_WARNING, type StatementLinesCheck } from "@/lib/domain/statement-repeats";
import { checkRun, type RunStatement } from "@/lib/domain/statement-run";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";

/**
 * The screens of 2.04, "Statement proof and repeated lines": the statement
 * import dialog's proof panel and lines preview (rendered from the dialog's
 * own state), the dialog's wiring to the server, the four ways a statement
 * comes in sending the proof, and a run of statement files stopping at a
 * statement that does not add up. The wiring is read from the source, as the
 * other statement-screen contracts do. Every bank, name and amount is invented.
 */

const ROOT = process.cwd();
const BANKING = join(ROOT, "app", "(app)", "banking");
/** A source file, its line endings as the repository keeps them: a Windows checkout writes CRLF. */
const read = (...parts: string[]) => readFileSync(join(BANKING, ...parts), "utf8").replace(/\r\n/g, "\n");
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

/** A function's body: from its declaration to the first line that closes it at the given indent. */
function body(source: string, start: string, close = "\n  }\n"): string {
  const at = source.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  const end = source.indexOf(close, at);
  expect(end, `${start} has no end`).toBeGreaterThan(at);
  return source.slice(at, end);
}

/** A stylesheet's phone rules: everything from its `@media (max-width: 640px)`. */
function phoneRules(css: string): string {
  const at = css.indexOf("@media (max-width: 640px)");
  expect(at, "no phone rules").toBeGreaterThan(-1);
  return css.slice(at);
}

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
const NOTHING_HERE: StatementLinesCheck = { present: [], otherSource: [] };

const viewOf = (over: Partial<StatementDialogInput> = {}): StatementDialogView =>
  statementDialogView(
    {
      purpose: "import",
      kind: "pdf",
      lines: LINES,
      figures: PRINTED,
      prior: null,
      marks: NO_MARKS,
      check: NOTHING_HERE,
      canOverride: false,
      ...over,
    },
    money,
  );
const marks = (over: Partial<DialogMarks>): DialogMarks => ({ ...NO_MARKS, ...over });

function renderPanel(view: StatementDialogView, typed: Partial<Pick<DialogMarks, "typedOpeningMinor" | "typedClosingMinor">> = {}) {
  return renderToString(
    createElement(StatementProofPanel, {
      view,
      decimals: 2,
      typedOpeningMinor: typed.typedOpeningMinor ?? null,
      typedClosingMinor: typed.typedClosingMinor ?? null,
      onTypedOpening: () => {},
      onTypedClosing: () => {},
      onUsePrior: () => {},
      onImportAnyway: () => {},
      busy: false,
    }),
  );
}

function renderPreview(view: StatementDialogView, aside: number[] = [], lines: StatementLine[] = LINES) {
  return renderToString(
    createElement(StatementLinesPreview, {
      lines,
      aside: new Set(aside),
      onAside: () => {},
      view,
      onBack: () => {},
      money,
    }),
  );
}

// --- The proof panel ---------------------------------------------------------------

describe("the proof panel", () => {
  it("says a statement that adds up adds up, with its basis, and blocks nothing", () => {
    const out = text(renderPanel(viewOf()));
    expect(out).toContain("Opening $1000.00 (printed) + 3 lines $180.00 = $1180.00, the closing balance the statement prints ✓");
    expect(out).not.toContain(PROOF_TEXT.blocked);
    expect(out).not.toContain(PROOF_TEXT.importAnyway);
    expect(out).not.toContain(PROOF_TEXT.adminCanOverride);
  });

  it("blocks a statement that is out, names the line, and offers Import anyway… to an administrator only", () => {
    const misread = { ...PRINTED, closingMinor: 120000 };
    const admin = text(renderPanel(viewOf({ figures: misread, canOverride: true })));
    expect(admin).toContain("Out by $20.00. The opening $1000.00 and the 3 lines come to $1180.00; the statement closes at $1200.00.");
    expect(admin).toContain("It equals the statement line “SERVICE FEE” of Mar 20, 2026 (−20.00), which may have been misread.");
    expect(admin).toContain("Import is blocked until the statement adds up.");
    expect(admin).toContain("Import anyway…");
    expect(admin).not.toContain(PROOF_TEXT.adminCanOverride);

    const other = text(renderPanel(viewOf({ figures: misread, canOverride: false })));
    expect(other).toContain("Import is blocked until the statement adds up.");
    expect(other).toContain("An administrator can import it anyway, with a reason.");
    expect(other).not.toContain("Import anyway…");
  });

  it("asks for a missing balance by the field the spec names, and offers the prior closing on its button", () => {
    const missing = viewOf({ kind: "qif", figures: {}, prior: { date: "2026-02-28", endingMinor: 100000 } });
    const html = renderPanel(missing);
    const out = text(html);
    expect(out).toContain(PROOF_REFUSAL.noBalances);
    expect(out).toContain("Import is blocked until the statement adds up.");
    expect(out).toContain("Opening balance printed on the statement");
    expect(out).toContain("Closing balance printed on the statement");
    expect(out).toContain("Use $1000.00 (the closing of the reconciliation to Feb 28, 2026)");
    expect(html).toContain('aria-pressed="false"');
    // A balance missing is never imported anyway.
    expect(out).not.toContain(PROOF_TEXT.importAnyway);
    expect(out).not.toContain(PROOF_TEXT.adminCanOverride);
  });

  it("keeps a typed field on screen, so the figure can be corrected", () => {
    const typed = viewOf({ figures: { ...PRINTED, closingMinor: null }, marks: marks({ typedClosingMinor: 118000 }) });
    const out = text(renderPanel(typed, { typedClosingMinor: 118000 }));
    expect(out).toContain("the closing balance the statement prints ✓");
    expect(out).toContain("Closing balance printed on the statement");
    expect(out).not.toContain("Opening balance printed on the statement");
  });

  it("never offers to attach anyway", () => {
    const out = text(renderPanel(viewOf({ purpose: "attach", figures: { ...PRINTED, closingMinor: 117500 }, canOverride: true })));
    expect(out).toContain("Attaching is blocked until the statement adds up.");
    expect(out).not.toContain(PROOF_TEXT.importAnyway);
    expect(out).not.toContain(PROOF_TEXT.adminCanOverride);
  });
});

// --- The lines preview -------------------------------------------------------------

describe("the lines preview", () => {
  it("gives every line its Not a transaction tick, and strikes a ticked line through", () => {
    const html = renderPreview(viewOf({ marks: marks({ aside: [2] }) }), [2]);
    expect(text(html)).toContain(NOT_A_TRANSACTION);
    expect(html.match(/type="checkbox"/g)?.length).toBe(LINES.length);
    expect(html.match(/ant-checkbox-checked/g)?.length).toBe(1);
    // The struck line, and only it.
    expect(html.match(/<del>/g)?.length).toBe(3);
    expect(html).toMatch(/<del>SERVICE FEE<\/del>/);
    expect(html).not.toMatch(/<del>RENT<\/del>/);
  });

  it("leaves a ticked line out of the count and out of what is sent", () => {
    const view = viewOf({ figures: { ...PRINTED, closingMinor: 120000 }, marks: marks({ aside: [2] }) });
    expect(view.okLabel).toBe("Import 2 lines");
    const sent = confirmStatement(LINES, marks({ aside: [2] }), view);
    expect(sent.rows.map((row) => row.description)).toEqual(["DEPOSIT", "RENT"]);
    expect(sent.proof.set_aside).toBe(1);
  });

  it("lists the lines already here from another source, skipped by default, each ticked back on its own", () => {
    const check: StatementLinesCheck = { present: [], otherSource: [{ index: 1, source: "books", bankLineId: "bl-1" }] };
    const skipped = renderPreview(viewOf({ check }));
    expect(text(skipped)).toContain(OTHER_SOURCE_WARNING);
    expect(OTHER_SOURCE_WARNING).toBe("Already in Bank Transactions from another source (the books, a bank feed or another file)");
    expect(text(skipped)).toContain(OTHER_SOURCE_NOTE);
    expect(text(skipped)).toContain("Mar 9, 2026 · RENT · -$300.00");
    // Three Not a transaction ticks and the line's own, none of them ticked.
    expect(skipped.match(/type="checkbox"/g)?.length).toBe(LINES.length + 1);
    expect(skipped).not.toContain("ant-checkbox-checked");
    expect(confirmStatement(LINES, NO_MARKS, viewOf({ check })).rows[1].skip).toBe(true);

    const back = renderPreview(viewOf({ check, marks: marks({ back: [1] }) }));
    expect(back.match(/ant-checkbox-checked/g)?.length).toBe(1);
    expect(confirmStatement(LINES, marks({ back: [1] }), viewOf({ check, marks: marks({ back: [1] }) })).rows[1].skip).toBeUndefined();
  });

  it("says each set of identical lines, and what becomes of it", () => {
    const payroll = [line("2026-03-31", -41230, "PAYROLL"), line("2026-03-31", -41230, "PAYROLL"), line("2026-03-31", -41230, "PAYROLL")];
    const view = viewOf({
      lines: payroll,
      figures: { openingMinor: 200000, closingMinor: 200000 - 3 * 41230 },
      check: { present: [0], otherSource: [] },
    });
    expect(text(renderPreview(view, [], payroll))).toContain(
      "3 identical lines on Mar 31, 2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.",
    );
  });

  it("fits the dialog, and keeps every column on a phone by scrolling inside its own box", () => {
    expect(IMPORT_DIALOG_BOX).toBe(IMPORT_DIALOG_WIDTH - 48);
    expect(IMPORT_PREVIEW_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    expect(IMPORT_PREVIEW_WIDTH.date).toBe(COLUMN.DATE);
    expect(IMPORT_PREVIEW_WIDTH.amount).toBe(COLUMN.MONEY);
    expect(fitsBox(sum(Object.values(IMPORT_PREVIEW_WIDTH)), IMPORT_PREVIEW_ELASTIC_FLOOR, IMPORT_DIALOG_BOX)).toBe(true);
    expect(IMPORT_PREVIEW_MIN_WIDTH).toBe(sum(Object.values(IMPORT_PREVIEW_WIDTH)) + IMPORT_PREVIEW_ELASTIC_FLOOR);
    const phone = phoneRules(read("import-statement.module.css"));
    expect(phone).toContain(`.preview :global(.ant-table-content) > table {\n    min-width: ${IMPORT_PREVIEW_MIN_WIDTH}px;`);
    expect(phone).toMatch(/\.columns,\s*\.fields \{\s*grid-template-columns: minmax\(0, 1fr\);/);

    const preview = read("StatementLinesPreview.tsx");
    expect(preview).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(preview).not.toMatch(/<Table(?!\w)/);
    expect(preview).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
    expect(preview).not.toMatch(/pageSize:\s*\d/);
    expect(preview).toContain("<div className={styles.preview}>");
    for (const key of Object.keys(IMPORT_PREVIEW_WIDTH)) expect(preview, key).toContain(`width: PW.${key}`);
    expect(read("ImportStatementModal.tsx")).toContain("width={IMPORT_DIALOG_WIDTH}");
  });

  it("uses no colour of its own, so the dark theme follows", () => {
    for (const file of [
      "import-statement.module.css",
      "StatementProofPanel.tsx",
      "StatementLinesPreview.tsx",
      "ImportStatementModal.tsx",
      "PdfStatementPreview.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
    }
  });
});

// --- The dialog's wiring -----------------------------------------------------------

describe("the import dialog", () => {
  const modal = read("ImportStatementModal.tsx");

  it("works out what it shows and sends with the domain, and keeps Import N lines to one click when it adds up", () => {
    expect(modal).toContain("statementDialogView({ purpose, kind, lines, figures, prior, marks, check, canOverride }");
    expect(modal).toContain("okButtonProps={{ disabled: view.okDisabled, loading: importing }}");
    expect(modal).toContain("onOk={confirm}");
    const confirm = body(modal, "function confirm() {");
    expect(confirm).toContain("if (view.okDisabled) return;");
    expect(confirm).toContain("send(null);");
    const send = body(modal, "function send(override: StatementOverride | null) {");
    expect(send).toContain("confirmStatement(lines, marks, view, override)");
  });

  it("asks which lines are already here again whenever the Not a transaction ticks change, and reads the prior closing", () => {
    expect(modal).toContain('const checkKey = purpose === "import" && lines.length ? `${linesKey}#${marks.aside.join(",")}` : "";');
    expect(modal).toContain(
      "checkStatementLinesAction({ bank_account_id: bankAccount.id, lines: lines.map(checkLine), aside: [...marks.aside] })",
    );
    expect(modal).toContain("const check = checkOf?.key === checkKey ? checkOf.result : null;");
    expect(modal).toContain("priorClosingAction(accountId)");
  });

  it("requires a reason for Import anyway…: OK starts disabled, follows the reason, and nothing is sent without one", () => {
    const anyway = body(modal, "function importAnyway() {");
    expect(anyway).toContain('if (view.override !== "button" || view.checking || importing) return;');
    expect(anyway).toContain("okButtonProps: { danger: true, disabled: true }");
    expect(anyway).toContain(
      "dialog.update({ okButtonProps: { danger: true, disabled: overrideReasonProblem(reason) !== null } })",
    );
    const check = anyway.indexOf("const problem = overrideReasonProblem(reason);");
    const sent = anyway.indexOf("send({ reason: reason.trim() });");
    expect(check).toBeGreaterThan(-1);
    expect(sent).toBeGreaterThan(check);
    expect(anyway.slice(check, sent)).toContain("throw new Error(problem);");
    expect(anyway).toContain("maxLength={OVERRIDE_REASON_MAX}");
    expect(modal).toContain("onImportAnyway={importAnyway}");
  });

  it("says why nothing can be sent while the lines could not be checked", () => {
    expect(modal).toContain("linesCheckFailed(checkError)");
    expect(modal).toContain("{CHECKING_LINES}");
  });

  it("leaves the proof to the panel: the PDF preview no longer says its own", () => {
    const pdf = read("PdfStatementPreview.tsx");
    expect(pdf).not.toContain("summary.proof");
    expect(pdf).not.toContain("summary.proves");
    // The old button, "Import N lines anyway", one click whatever the proof said.
    expect(modal).not.toContain('" anyway"');
    expect(modal).not.toContain("summarizeStatement");
  });
});

// --- The four ways a statement comes in ----------------------------------------------

describe("the four ways a statement comes in", () => {
  const banking = read("BankingClient.tsx");
  const workspace = read("reconcile", "[id]", "ReconcileWorkspaceClient.tsx");
  const fromFiles = read("reconcile", "from-files", "FromFilesClient.tsx");

  it("Banking › Import statement sends the lines and the proof, and says what was imported", () => {
    const handler = body(banking, "async function confirmImport(");
    expect(handler).toContain("importStatementAction(selectedId, fileName, rows, kept.ok ? kept.id : null, proof)");
    expect(handler).toContain("message.error(result.error ?? \"Import failed\", 10);");
    expect(handler).toContain("importedSummary({");
    expect(handler).toContain("alreadyHere: result.data.skipped,");
    expect(handler).toContain("otherSource: result.data.otherSource,");
    expect(banking).not.toContain("duplicate(s) skipped");
    expect(banking).toContain("canOverride={canOverride}");
    expect(read("page.tsx")).toContain("canOverride={isAdmin(role)}");
  });

  it("importing into a reconciliation sends the lines and the proof, and keeps the pairing message after the summary", () => {
    const handler = body(workspace, "async function importStatement(");
    expect(handler).toMatch(/file_name: fileName,\s*lines: rows,\s*proof,\s*statement_file_id:/);
    expect(handler).not.toContain("opening_minor");
    expect(handler).not.toContain("closing_minor");
    expect(handler).toContain("alreadyHere: res.data.duplicates,");
    expect(handler).toContain("otherSource: res.data.otherSource,");
    expect(handler).toContain("message.success(`${imported} ${pairingMessage(res.data.outcome)}`, 8);");
    expect(handler).toContain("message.error(res.error ?? \"Failed to import the statement\", 10);");
    expect(workspace).not.toContain("already there.");
  });

  it("attaching checks the counted lines as the server does, and sends the ticks and the proof", () => {
    const handler = body(workspace, "async function attachStatement(");
    expect(handler).toContain("attachMismatch(");
    expect(handler).toContain("setAside: l.setAside");
    expect(handler).toMatch(/lines: read\.lines,\s*aside,\s*proof,/);
    expect(workspace).not.toContain("statementFileMismatch(");
    expect(handler).toContain("message.error(res.error ?? \"Failed to attach the statement\", 10);");
  });

  it("only the import into a reconciliation offers Import anyway…; attaching never does", () => {
    const dialogs = workspace.split("<ImportStatementModal").slice(1);
    expect(dialogs).toHaveLength(2);
    const [importing, attaching] = dialogs;
    expect(importing).toContain("canOverride={canOverride}");
    expect(attaching).toContain('purpose="attach"');
    expect(attaching.slice(0, attaching.indexOf("/>"))).not.toContain("canOverride");
    expect(read("reconcile", "[id]", "page.tsx")).toContain("canOverride={isAdmin(role)}");
  });

  it("a month of a run sends its proof, and no balances of its own", () => {
    expect(fromFiles.match(/proof: runStatementPayload\(statement\),/g)?.length).toBe(2);
    expect(fromFiles).not.toContain("opening_minor: statement.openingMinor");
    expect(fromFiles).not.toContain("closing_minor: statement.closingMinor");
  });
});

// --- A run of statement files --------------------------------------------------------

describe("a run of statement files", () => {
  const fromFiles = read("reconcile", "from-files", "FromFilesClient.tsx");

  /** An invented CSV month, its opening and closing given. */
  const month = (to: string, opening: number, closing: number, amount: number): RunStatement => ({
    key: to,
    fileName: `${to}.csv`,
    source: "PDF",
    from: `${to.slice(0, 8)}01`,
    to,
    openingMinor: opening,
    closingMinor: closing,
    lines: [line(`${to.slice(0, 8)}05`, amount, "DEPOSIT")],
    problem: null,
    outByMinor: null,
  });

  it("shows each statement's proof under what was read", () => {
    expect(fromFiles).toContain("{c.proof.sentences.summary}");
    expect(fromFiles).toContain("{c.proof.sentences.detail}");
    expect(fromFiles).toContain('color={c.proof && !c.proof.proves ? "red" : STATE_COLOR[c.state]}');
  });

  it("stops at the first statement that does not add up, with the stop message, and previews nothing", () => {
    const result = checkRun(
      [month("2026-07-31", 1000, 1100, 100), month("2026-08-31", 1100, 1250, 100), month("2026-09-30", 1250, 1300, 50)],
      { lastCompleted: { date: "2026-06-30", endingMinor: 1000 }, completedDates: ["2026-06-30"], inProgress: null, today: "2026-12-31" },
      money,
    );
    expect(result.statements.map((c) => c.proof?.proves)).toEqual([true, false, true]);
    expect(result.statements[1].proof?.sentences.summary).toBe(
      "Out by $0.50. The opening $11.00 and the 1 line come to $12.00; the statement closes at $12.50.",
    );
    expect(result.stops).toEqual([
      "The statement closing Aug 31, 2026 does not add up. Out by $0.50 — import this statement on its own to correct it.",
    ]);
    // The screen draws every stop, and a stop keeps Preview and Sign off from going.
    expect(fromFiles).toContain("{check.stops.map((stop) => (");
    expect(fromFiles).toContain("disabled={check.stops.length > 0 || reading > 0 || busy}");
    expect(fromFiles).toContain("if (!preview || previewing || check.stops.length > 0) return;");
  });
});

// --- Release notes and the Guide -------------------------------------------------------

describe("2.04 in the release notes and the Guide", () => {
  const release = RELEASES[0];
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is the newest release, dated the day it was built", () => {
    expect(release.version).toBe("2.04");
    expect(release.date).toBe("2026-10-14");
  });

  it("says what the person sees, in the screen's words", () => {
    for (const words of [
      "Import is blocked until the statement adds up.",
      "Not a transaction",
      "Opening balance printed on the statement",
      "Closing balance printed on the statement",
      "Import anyway…",
      "An administrator can import it anyway, with a reason.",
      "3 identical lines on Mar 31, 2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.",
      OTHER_SOURCE_WARNING,
      "Two lines with the same bank id are both kept",
      "import this statement on its own to correct it.",
    ]) {
      expect(said, words).toContain(words);
    }
    expect(release.changes.map((c) => c.route)).toContain("/banking/reconcile/from-files");
  });

  it("gives the Guide the import, what to do when it is blocked, and the override", () => {
    const steps = GUIDE_FLOWS.flatMap((flow) => flow.steps);
    const step = (control: string, action: string) => {
      const found = steps.find((s) => s.control === control && s.action === action);
      expect(found, `${control}: ${action}`).toBeDefined();
      return found?.note ?? "";
    };
    expect(step("Import statement", "Check that the statement adds up")).toContain(
      "Import is blocked until the statement adds up",
    );
    expect(step("Not a transaction", "Make a statement add up")).toContain("Closing balance printed on the statement");
    expect(step("Import anyway…", "Import a statement that does not add up")).toContain("kept with the import and in the audit log");
    expect(step("From statement files", "Reconcile from the statement files, one month or a year")).toContain(
      "A statement that does not add up stops the run there",
    );
  });
});
