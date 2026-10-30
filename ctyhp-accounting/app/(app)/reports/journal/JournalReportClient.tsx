"use client";
import { sourceLabel } from "@/lib/domain/entry-detail";
import { useCallback, useState, type Key } from "react";
import { Select, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { formatDate, formatMoney } from "@/lib/format";
import { journalReportSheet } from "@/lib/domain/ledger-report-sheets";
import { journalEntryAmountMinor } from "@/lib/domain/journal-entry-amount";
import { flexColumn } from "@/components/ui/columns";
import { longTextColumn } from "@/components/ui/long-text-column";
import { COLUMN } from "@/lib/design/table-metrics";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { journalReportAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

const SOURCES = [
  "invoice",
  "sales_receipt",
  "payment",
  "manual",
  "bank",
  "reconciliation",
  "opening_balance",
  "bill",
  "expense",
  "bill_payment",
  "tax_payment",
  "stock_count",
  "cash_count",
];

const PAGE_SIZE = 50;

/** "Opening balance", the longest source, as a tag on one line. */
const SOURCE_WIDTH = 132;

/** An opened entry's lines: Debit and Credit. Account takes what is left, at least COLUMN.TEXT_MIN. */
export const JOURNAL_REPORT_LINES_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.MONEY] as const;

/** A description cut to its column, whole in a tooltip that wraps. */
const describe = longTextColumn().render;

interface Props {
  companyName: string;
  presets: PresetContext;
  baseCurrency: string;
  baseDecimals: number;
  initialEntryId?: string;
}

export default function JournalReportClient({ companyName, presets, baseCurrency, baseDecimals, initialEntryId }: Props) {
  const [source, setSource] = useState<string>();
  // A new source runs the report again over the dates last run.
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>(
    initialEntryId ? [initialEntryId] : [],
  );
  const fmt = (m: number) => (m ? formatMoney(m, baseCurrency, baseDecimals) : "");

  // An "All dates" period has no start, which the report reads as every date.
  const load = useCallback(
    async (when: ReportWhen): Promise<ReportRunResult<JournalEntrySummary[]>> =>
      journalReportAction({
        entryId: initialEntryId ?? null,
        sourceType: source ?? null,
        from: when.from,
        to: when.to,
      }),
    [source, initialEntryId],
  );
  const sheet = useCallback(
    (entries: JournalEntrySummary[], when: ReportWhen) =>
      journalReportSheet(entries, when, { companyName, currencyCode: baseCurrency, baseDecimals }),
    [companyName, baseCurrency, baseDecimals],
  );

  return (
    <SimpleReport<JournalEntrySummary[]>
      companyName={companyName}
      title="Journal Report"
      currencyCode={baseCurrency}
      period={{ kind: "range", ctx: presets, preset: "all" }}
      load={load}
      sheet={sheet}
      runningText="Reading the journal…"
      refreshKey={refreshKey}
      filters={
        <Select
          allowClear
          style={{ width: 200 }}
          placeholder="Source"
          aria-label="Source"
          value={source}
          onChange={(value) => {
            setSource(value);
            setRefreshKey((key) => key + 1);
          }}
          options={SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))}
        />
      }
      render={(data, _when, { printing }) => (
        <DataTable<JournalEntrySummary>
          rowKey="id"
          dataSource={data}
          pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
          emptyTitle="No journal entries"
          emptyDescription="No entries match the selected source and date range."
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
            expandedRowRender: (e) => (
              <DataTable<JournalEntrySummary["lines"][number]>
                rowKey={(_, i) => String(i)}
                pagination={false}
                rows={e.lines}
                columns={[
                  flexColumn<JournalEntrySummary["lines"][number]>({
                    title: "Account",
                    key: "account",
                    render: (_, l) => `${l.accountCode} ${l.accountName}`,
                  }),
                  { title: "Debit", key: "debit", width: JOURNAL_REPORT_LINES_FIXED_WIDTHS[0], align: "right", render: (_, l) => fmt(l.debitMinor) },
                  { title: "Credit", key: "credit", width: JOURNAL_REPORT_LINES_FIXED_WIDTHS[1], align: "right", render: (_, l) => fmt(l.creditMinor) },
                ]}
              />
            ),
          }}
          // Every column but the description has a width, and the description
          // takes the rest. With no widths at all, the five columns shared the
          // table evenly and the description, a fifth of it, ran four and five
          // lines tall (UI review, 2026-10-20). Amount is new: an entry listed
          // with no amount said nothing of its size.
          columns={[
            { title: "Number", dataIndex: "entryNumber", width: COLUMN.CODE },
            { title: "Date", dataIndex: "entryDate", width: COLUMN.DATE, render: (v: string) => formatDate(v) },
            { title: "Source", dataIndex: "sourceType", width: SOURCE_WIDTH, render: (s: string) => <Tag>{sourceLabel(s)}</Tag> },
            flexColumn<JournalEntrySummary>({ title: "Description", dataIndex: "description", render: describe }),
            {
              title: "Amount",
              key: "amount",
              width: COLUMN.MONEY_WIDE,
              align: "right",
              render: (_, e) => formatMoney(journalEntryAmountMinor(e.lines), baseCurrency, baseDecimals),
            },
            {
              title: "Status",
              width: COLUMN.STATUS,
              render: (_, e) => (e.isReversed ? <StatusTag status="reversed" /> : <StatusTag status={e.status} />),
            },
          ]}
        />
      )}
    />
  );
}
