import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assembleIndirectCashFlow,
  type CashFlowContribution,
  type CashFlowStatementSection,
  type IndirectCashFlowReport,
} from "@/lib/domain/cashflow";

export class CashFlowError extends Error {}
export type CashFlowReport = IndirectCashFlowReport;

export interface CashFlowDetail {
  section: CashFlowStatementSection;
  lineCode: string;
  label: string;
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  amountMinor: number;
  classificationBasis: string;
}

interface SummaryRpcRow {
  section: string;
  line_code: string;
  label: string;
  amount_minor: number | string;
  detail_count: number | string;
  sort_order: number | string;
}

interface DetailRpcRow {
  section: string;
  line_code: string;
  label: string;
  journal_entry_id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source_type: string;
  source_id: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  amount_minor: number | string;
  classification_basis: string;
}

function statementSection(value: string): CashFlowStatementSection {
  if (
    value === "operating" ||
    value === "investing" ||
    value === "financing" ||
    value === "unclassified"
  ) {
    return value;
  }
  throw new CashFlowError(`Unexpected cash-flow section: ${value}`);
}

export async function getCashFlow(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<CashFlowReport> {
  const { data, error } = await sb.rpc("acc_cash_flow_indirect", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new CashFlowError(error.message);

  const rows = (data ?? []) as SummaryRpcRow[];
  const openingRow = rows.find((row) => row.line_code === "opening_cash");
  const closingRow = rows.find((row) => row.line_code === "closing_cash");
  if (!openingRow || !closingRow) {
    throw new CashFlowError("Cash-flow reconciliation did not return opening and closing cash");
  }

  const contributions: CashFlowContribution[] = rows
    .filter((row) => row.section !== "meta")
    .sort((left, right) => Number(left.sort_order) - Number(right.sort_order))
    .map((row) => ({
      section: statementSection(row.section),
      lineCode: row.line_code,
      label: row.label,
      amountMinor: Number(row.amount_minor),
      detailCount: Number(row.detail_count),
    }));

  return assembleIndirectCashFlow(
    contributions,
    Number(openingRow.amount_minor),
    Number(closingRow.amount_minor),
  );
}

export async function getCashFlowDetails(
  sb: SupabaseClient,
  from: string,
  to: string,
  lineCode: string,
): Promise<CashFlowDetail[]> {
  const { data, error } = await sb.rpc("acc_cash_flow_indirect_detail", {
    p_from: from,
    p_to: to,
    p_line_code: lineCode,
  });
  if (error) throw new CashFlowError(error.message);

  return ((data ?? []) as DetailRpcRow[]).map((row) => ({
    section: statementSection(row.section),
    lineCode: row.line_code,
    label: row.label,
    journalEntryId: row.journal_entry_id,
    entryNumber: row.entry_number,
    entryDate: row.entry_date,
    description: row.description,
    sourceType: row.source_type,
    sourceId: row.source_id,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    amountMinor: Number(row.amount_minor),
    classificationBasis: row.classification_basis,
  }));
}
