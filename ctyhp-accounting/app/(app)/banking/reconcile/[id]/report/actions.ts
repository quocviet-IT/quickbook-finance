"use server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { ReconReportInput } from "@/lib/domain/reconciliation-report";
import {
  findReconciliationHeader,
  getBroughtForwardPreview,
  getReconciliationDetail,
  getReconciliationReportLines,
} from "@/lib/services/bankrec";
import { isCardBankAccount } from "@/lib/services/banking";
import { cardBookLines, shown } from "@/lib/domain/card-account";

/**
 * One reconciliation's report: read-only. The statement's figures as signed
 * off, its lines as the books hold them now, and the bank account's balance in
 * the books on the statement date — the three the report proves against each
 * other.
 */
export async function reconciliationReportAction(id: string, when: ReportWhen): Promise<ReportRunResult<ReconReportInput>> {
  try {
    checkWhen(when, "none");
    if (!z.uuid().safeParse(id).success) throw new Error("There is no such reconciliation.");
    const sb = await createSupabaseServerClient();
    const header = await findReconciliationHeader(sb, id);
    if (!header) throw new Error("There is no such reconciliation.");
    const [detail, lines, books, isCard] = await Promise.all([
      getReconciliationDetail(sb, id),
      getReconciliationReportLines(sb, id),
      getBroughtForwardPreview(sb, header.bankAccountId, header.endingDate),
      isCardBankAccount(sb, header.bankAccountId),
    ]);
    // A credit card's report (2.45) is set out as its statement prints it: what is owed.
    const side = isCard ? "card" : "bank";
    return {
      ok: true,
      data: {
        completed: header.status === "completed",
        statementDate: header.endingDate,
        beginningMinor: shown(detail.beginningMinor, side),
        statementEndingMinor: shown(detail.statementEndingMinor, side),
        bookBalanceMinor: shown(books.bookBalanceMinor, side),
        lines: cardBookLines(lines, side),
        adjustmentEntryId: header.adjustmentEntryId,
        adjustmentReason: header.adjustmentReason,
        note: header.note,
        side,
      },
    };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
