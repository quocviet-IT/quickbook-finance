/**
 * The report of one bank reconciliation, set out as the approved design sets
 * one out (`recReportBody`): two halves, the way a bank reconciliation has
 * always been written down. What the bank confirmed on this statement, and
 * what it had not seen yet. The second half is the one that matters, because
 * it is the bridge from the bank's balance to the books'.
 *
 * The signed-off closing balance is the fixed fact: it is what the bank said
 * on the day. Everything else is worked out from the books as they stand now,
 * so an entry changed after sign-off shows up as the two failing to meet.
 */
import { fromMinor } from "./money";
import { sourceLabel } from "./entry-detail";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { formatDate, plural } from "@/lib/format";

export interface ReconReportLine {
  journalLineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  sourceType: string;
  memo: string | null;
  reference: string | null;
  /** Money into the bank account is positive. */
  signedMinor: number;
  /** Cleared on this statement; otherwise outstanding on it. */
  cleared: boolean;
}

export interface ReconReportInput {
  completed: boolean;
  statementDate: string;
  beginningMinor: number;
  /** The statement's closing balance, as signed off (or entered so far). */
  statementEndingMinor: number;
  /** The bank account's balance in the books on the statement date, as the books stand now. */
  bookBalanceMinor: number;
  lines: readonly ReconReportLine[];
  adjustmentEntryId: string | null;
  adjustmentReason: string | null;
  /** How it was signed off, when the reconciliation says (brought forward, a run of statements). */
  note: string | null;
}

export type ReconReportSectionKey = "cleared-in" | "cleared-out" | "outstanding-in" | "outstanding-out";

export interface ReconReportSection {
  key: ReconReportSectionKey;
  title: string;
  note: string | null;
  lines: ReconReportLine[];
  totalMinor: number;
}

export interface ReconReport {
  /** In the design's order: cleared in, cleared out, outstanding in, outstanding out. */
  sections: ReconReportSection[];
  /** The opening balance plus everything ticked, as those entries stand now. */
  clearedBalanceMinor: number;
  statementAgrees: boolean;
  /** The closing balance plus everything the bank had not seen. */
  bridgedBookMinor: number;
  booksAgree: boolean;
  provesOut: boolean;
  /** What the adjusting entry moved on the bank account, when one closed the difference. */
  adjustmentMinor: number | null;
}

const sum = (lines: readonly ReconReportLine[]) => lines.reduce((total, line) => total + line.signedMinor, 0);

export function buildReconciliationReport(input: ReconReportInput): ReconReport {
  const date = formatDate(input.statementDate);
  const pick = (cleared: boolean, moneyIn: boolean) =>
    input.lines.filter((line) => line.cleared === cleared && line.signedMinor >= 0 === moneyIn);
  const section = (key: ReconReportSectionKey, title: string, note: string | null, lines: ReconReportLine[]): ReconReportSection => ({
    key,
    title,
    note,
    lines,
    totalMinor: sum(lines),
  });
  const sections = [
    section("cleared-in", "Cleared deposits and other credits", "On the statement and confirmed by the bank.", pick(true, true)),
    section("cleared-out", "Cleared payments and checks", null, pick(true, false)),
    section(
      "outstanding-in",
      "Deposits in the books, not yet on the statement",
      `Money paid in that the bank had not credited by ${date}.`,
      pick(false, true),
    ),
    section(
      "outstanding-out",
      "Payments in the books, not yet on the statement",
      `Checks written and payments made that had not been presented by ${date}.`,
      pick(false, false),
    ),
  ];
  const [clearedIn, clearedOut, outstandingIn, outstandingOut] = sections;
  const clearedBalanceMinor = input.beginningMinor + clearedIn.totalMinor + clearedOut.totalMinor;
  const statementAgrees = clearedBalanceMinor === input.statementEndingMinor;
  const bridgedBookMinor = input.statementEndingMinor + outstandingIn.totalMinor + outstandingOut.totalMinor;
  const booksAgree = bridgedBookMinor === input.bookBalanceMinor;
  const adjustmentLines = input.adjustmentEntryId ? input.lines.filter((line) => line.entryId === input.adjustmentEntryId) : [];
  return {
    sections,
    clearedBalanceMinor,
    statementAgrees,
    bridgedBookMinor,
    booksAgree,
    provesOut: statementAgrees && booksAgree,
    adjustmentMinor: adjustmentLines.length > 0 ? sum(adjustmentLines) : null,
  };
}

export interface ReconSummaryRow {
  key: string;
  label: string;
  amountMinor: number;
  /** A total is the bold line a half ends on; a warning is a figure that no longer meets. */
  kind: "line" | "total" | "warning";
  indent: boolean;
  /** The second half starts here. */
  gapBefore: boolean;
}

/** The bridge, top to bottom: the bank's side, then the books'. */
export function reconciliationSummaryRows(report: ReconReport, input: ReconReportInput): ReconSummaryRow[] {
  const [clearedIn, clearedOut, outstandingIn, outstandingOut] = report.sections;
  const row = (key: string, label: string, amountMinor: number, kind: ReconSummaryRow["kind"], indent: boolean, gapBefore = false): ReconSummaryRow => ({
    key,
    label,
    amountMinor,
    kind,
    indent,
    gapBefore,
  });
  return [
    row("opening", "Statement opening balance", input.beginningMinor, "line", false),
    row("cleared-in", `Deposits and other credits cleared (${clearedIn.lines.length})`, clearedIn.totalMinor, "line", true),
    row("cleared-out", `Payments and checks cleared (${clearedOut.lines.length})`, clearedOut.totalMinor, "line", true),
    row("closing", "Statement closing balance", input.statementEndingMinor, "total", false),
    ...(report.statementAgrees
      ? []
      : [
          row(
            "cleared-now",
            input.completed ? "What those cleared entries now come to" : "What the lines ticked so far come to",
            report.clearedBalanceMinor,
            "warning",
            true,
          ),
        ]),
    row("outstanding-in", `Deposits not yet on the statement (${outstandingIn.lines.length})`, outstandingIn.totalMinor, "line", true, true),
    row("outstanding-out", `Payments not yet on the statement (${outstandingOut.lines.length})`, outstandingOut.totalMinor, "line", true),
    row("books", `Balance in the books at ${formatDate(input.statementDate)}`, report.bridgedBookMinor, "total", false),
    // The bridge says what the books should hold; when they hold something else, say what.
    ...(report.booksAgree
      ? []
      : [row("books-now", `What the books say at ${formatDate(input.statementDate)}`, input.bookBalanceMinor, "warning", true)]),
  ];
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** What the report proves, in words, under the figures: the verdict, then why. */
export function reconciliationProof(
  report: ReconReport,
  input: ReconReportInput,
  money: (minor: number) => string,
): { headline: string; detail: string } {
  const date = formatDate(input.statementDate);
  if (!input.completed) {
    return {
      headline: "This reconciliation is still in progress.",
      detail: report.statementAgrees
        ? `The lines ticked so far come to the statement's closing balance of ${money(input.statementEndingMinor)}, so it can be signed off.`
        : `The lines ticked so far come to ${money(report.clearedBalanceMinor)} against the statement's closing balance of ${money(input.statementEndingMinor)}, a difference of ${money(input.statementEndingMinor - report.clearedBalanceMinor)}.`,
    };
  }
  const parts = [
    `The statement closing balance of ${money(input.statementEndingMinor)}, plus the deposits and less the payments the bank had not yet seen, comes to ${money(report.bridgedBookMinor)}` +
      (report.provesOut
        ? `, which is exactly the balance in the books on ${date}.`
        : !report.statementAgrees
          ? `, but the entries ticked on this statement now come to ${money(report.clearedBalanceMinor)} against the ${money(input.statementEndingMinor)} signed off, a difference of ${money(report.clearedBalanceMinor - input.statementEndingMinor)}. One of them has been changed or voided since.`
          : `, but the books say ${money(input.bookBalanceMinor)} on that date, a difference of ${money(input.bookBalanceMinor - report.bridgedBookMinor)}. An entry dated on or before this statement has been added or changed since it was signed off.`),
  ];
  if (report.adjustmentMinor !== null) {
    parts.push(
      sentence(
        `An adjustment of ${money(report.adjustmentMinor)} was posted to close the difference on the day` +
          (input.adjustmentReason ? `: ${input.adjustmentReason}` : ""),
      ),
    );
  }
  if (input.note) parts.push(sentence(`How it was signed off: ${input.note}`));
  return {
    headline: report.provesOut ? "This reconciliation proves out." : "This reconciliation no longer proves out.",
    detail: parts.join(" "),
  };
}

/**
 * What a line says in the report: its memo. Where it came from is already in
 * the Entry column, so a line with no memo says nothing rather than repeat it.
 */
export function reconLineDescription(line: ReconReportLine): string {
  return line.memo?.trim() ?? "";
}

/** The same report as a sheet: the bridge first, then each half's lines with their totals. */
export function reconciliationReportSheet(
  report: ReconReport,
  input: ReconReportInput,
  ctx: { companyName: string; accountLabel: string; currencyCode: string; baseDecimals: number },
): ReportExportSheet {
  const amount = (minor: number) => fromMinor(minor, ctx.baseDecimals);
  return {
    fileName: sanitizeExportFileName(`reconciliation-${ctx.accountLabel}-${input.statementDate}`),
    companyName: ctx.companyName,
    title: "Reconciliation Report",
    subtitle: `${ctx.accountLabel} · statement of ${formatDate(input.statementDate)}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "section", header: "Section", kind: "text", width: 40 },
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "entry", header: "Entry", kind: "text", width: 14 },
      { key: "reference", header: "Reference", kind: "text", width: 16 },
      { key: "description", header: "Description", kind: "text", width: 44 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
    ],
    rows: [
      ...reconciliationSummaryRows(report, input).map((row) => ({
        section: "Summary",
        date: null,
        entry: null,
        reference: null,
        description: row.label,
        amount: amount(row.amountMinor),
      })),
      ...report.sections.flatMap((section) => [
        ...section.lines.map((line) => ({
          section: section.title,
          date: formatDate(line.entryDate),
          entry: [sourceLabel(line.sourceType), line.entryNumber].filter(Boolean).join(" "),
          reference: line.reference ?? "",
          description: reconLineDescription(line),
          amount: amount(line.signedMinor),
        })),
        {
          section: section.title,
          date: null,
          entry: null,
          reference: null,
          description: `Total, ${plural(section.lines.length, "item")}`,
          amount: amount(section.totalMinor),
        },
      ]),
    ],
  };
}
