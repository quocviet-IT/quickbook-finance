"use client";
import { sourceLabel } from "@/lib/domain/entry-detail";
import { useCallback, useState, type Key } from "react";
import { Select, Table, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { formatDate, formatMoney } from "@/lib/format";
import { journalReportSheet } from "@/lib/domain/ledger-report-sheets";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { journalReportAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

const SOURCES = [
  "invoice",
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
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={e.lines}
                columns={[
                  { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                  { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                  { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
                ]}
              />
            ),
          }}
          columns={[
            { title: "Number", dataIndex: "entryNumber" },
            { title: "Date", dataIndex: "entryDate", render: (v: string) => formatDate(v) },
            { title: "Source", dataIndex: "sourceType", render: (s: string) => <Tag>{sourceLabel(s)}</Tag> },
            { title: "Description", dataIndex: "description" },
            {
              title: "Status",
              render: (_, e) => (e.isReversed ? <StatusTag status="reversed" /> : <StatusTag status={e.status} />),
            },
          ]}
        />
      )}
    />
  );
}
