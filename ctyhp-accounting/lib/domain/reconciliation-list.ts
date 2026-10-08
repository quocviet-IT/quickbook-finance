/**
 * Reconciliation Report: every statement reconciliation that was signed off,
 * and whether it still agrees with the books.
 *
 * A signed-off reconciliation balanced on the day it was signed. The only way
 * it stops balancing afterwards is that an entry it ticked is voided — the
 * cleared total counts posted entries only — and the database lists exactly
 * those lines (`acc_reconciliation_discrepancies`). So a reconciliation still
 * agrees when none of its ticked lines has been voided, and when one has, it is
 * out by the voided lines' amounts.
 *
 * Pure: sessions and voided lines in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

export interface SignedOffReconciliation {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  statementEndingDate: string;
  statementEndingBalanceMinor: number;
  completedAt: string | null;
  completedByName: string | null;
}

/** A line a signed-off reconciliation ticked whose entry has since been voided. */
export interface VoidedClearedLine {
  reconciliationId: string;
  entryNumber: string;
  /** Signed as the bank sees it: money in positive. */
  signedMinor: number;
}

export interface ReconciliationListLine extends SignedOffReconciliation {
  stillAgrees: boolean;
  /** What the reconciliation is now out by: the sum of its voided lines. 0 when it agrees. */
  differenceMinor: number;
  /** The entry numbers of its voided lines, for the reader to look up. */
  voidedEntries: string[];
}

export interface ReconciliationListReport {
  lines: ReconciliationListLine[];
  /** How many no longer agree. */
  outOfAgreement: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/** By bank account, then the newest statement first. */
export function reconciliationList(
  sessions: readonly SignedOffReconciliation[],
  voided: readonly VoidedClearedLine[],
): ReconciliationListReport {
  const byReconciliation = new Map<string, VoidedClearedLine[]>();
  for (const line of voided) {
    const list = byReconciliation.get(line.reconciliationId) ?? [];
    list.push(line);
    byReconciliation.set(line.reconciliationId, list);
  }
  const lines = sessions
    .map((session): ReconciliationListLine => {
      const lost = byReconciliation.get(session.id) ?? [];
      const differenceMinor = lost.reduce((sum, line) => sum + line.signedMinor, 0);
      return {
        ...session,
        stillAgrees: lost.length === 0,
        differenceMinor,
        voidedEntries: [...new Set(lost.map((line) => line.entryNumber))].sort(),
      };
    })
    .sort(
      (a, b) =>
        byName(a.bankAccountName, b.bankAccountName) ||
        a.bankAccountId.localeCompare(b.bankAccountId) ||
        b.statementEndingDate.localeCompare(a.statementEndingDate),
    );
  return { lines, outOfAgreement: lines.filter((line) => !line.stillAgrees).length };
}

export function reconciliationListSheet(
  report: ReconciliationListReport,
  ctx: { companyName: string; today: string; currencyCode: string; baseDecimals: number; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`reconciliation-report-${ctx.today}`),
    companyName: ctx.companyName,
    title: "Reconciliation Report",
    subtitle: `Signed-off reconciliations as of ${ctx.today}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "account", header: "Bank account", kind: "text", width: 30 },
      { key: "ending", header: "Statement ending", kind: "text", width: 14 },
      { key: "balance", header: "Ending balance", kind: "money", width: 16 },
      { key: "by", header: "Signed off by", kind: "text", width: 28 },
      { key: "at", header: "Signed off", kind: "text", width: 20 },
      { key: "agrees", header: "Still agrees", kind: "text", width: 12 },
      { key: "difference", header: "Out by", kind: "money", width: 14 },
      { key: "voided", header: "Voided entries", kind: "text", width: 24 },
    ],
    rows: report.lines.map((line) => ({
      account: line.bankAccountName,
      ending: line.statementEndingDate,
      balance: fromMinor(line.statementEndingBalanceMinor, ctx.baseDecimals),
      by: line.completedByName ?? "",
      at: line.completedAt ? stampInTimeZone(line.completedAt, ctx.timeZone) : "",
      agrees: line.stillAgrees ? "Yes" : "No",
      difference: line.stillAgrees ? null : fromMinor(line.differenceMinor, ctx.baseDecimals),
      voided: line.voidedEntries.join(", "),
    })),
  };
}
