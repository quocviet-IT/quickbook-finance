"use client";
import { Card, Collapse, Typography } from "antd";
import ReportTable from "@/components/ui/ReportTable";
import type { SectionEnvelope } from "@/lib/domain/accounting-dashboard/types";
import type { SecondaryAnalysis as SecondaryAnalysisData } from "@/lib/services/accounting-dashboard";
import { formatMoney } from "@/lib/format";
import { FreshnessNote, UnavailableNote } from "./DataStateNote";

/**
 * The analysis an accountant reaches for after the work, not before it.
 *
 * Collapsed by default and last on the page — that placement is the point of
 * the redesign, not an oversight. Everything here is a table rather than a
 * chart: a table is the accessible representation the design document requires
 * anyway, it costs no chart bundle on a section most readers never open, and
 * the ledger performance chart still lives on `/dashboard` for the reader who
 * wants the shape rather than the figures.
 */
export default function SecondaryAnalysis({
  secondary,
  currencyCode,
  currencyDecimals,
}: {
  secondary: SectionEnvelope<SecondaryAnalysisData>;
  currencyCode: string;
  currencyDecimals: number;
}) {
  const money = (minor: number) => formatMoney(minor, currencyCode, currencyDecimals);

  if (secondary.dataState === "unavailable" || !secondary.data) {
    return (
      <Card size="small" title="Secondary analysis">
        <UnavailableNote
          reason={secondary.unavailableReason ?? "The analysis could not be loaded."}
        />
      </Card>
    );
  }

  const { trend, sourceMix, recentEntries } = secondary.data;

  return (
    <Card size="small" title="Secondary analysis">
      <Collapse
        ghost
        items={[
          {
            key: "trend",
            label: `Ledger performance · ${trend.length} months`,
            children: (
              <ReportTable
                rowKey="key"
                dataSource={trend}
                columns={[
                  { title: "Month", dataIndex: "label" },
                  {
                    title: "Income",
                    dataIndex: "incomeMinor",
                    align: "right",
                    render: (v: number) => money(v),
                  },
                  {
                    title: "Expenses",
                    dataIndex: "expenseMinor",
                    align: "right",
                    render: (v: number) => money(v),
                  },
                  {
                    title: "Net",
                    key: "net",
                    align: "right",
                    render: (_, row) => money(row.incomeMinor - row.expenseMinor),
                  },
                ]}
              />
            ),
          },
          {
            key: "source-mix",
            label: "Journal source mix",
            children: (
              <ReportTable
                rowKey="key"
                dataSource={sourceMix}
                columns={[
                  { title: "Originating workflow", dataIndex: "label" },
                  { title: "Entries", dataIndex: "count", align: "right" },
                ]}
              />
            ),
          },
          {
            key: "activity",
            label: "Recent journal activity",
            children: (
              <ReportTable
                rowKey="id"
                dataSource={recentEntries}
                columns={[
                  { title: "Entry", dataIndex: "entryNumber" },
                  { title: "Date", dataIndex: "entryDate" },
                  { title: "Source", dataIndex: "sourceType" },
                  {
                    title: "Description",
                    dataIndex: "description",
                    render: (v: string) => (
                      <Typography.Text ellipsis={{ tooltip: v }}>{v}</Typography.Text>
                    ),
                  },
                  {
                    title: "Total",
                    dataIndex: "totalMinor",
                    align: "right",
                    render: (v: number) => money(v),
                  },
                  { title: "Status", dataIndex: "status" },
                ]}
              />
            ),
          },
        ]}
      />
      <FreshnessNote generatedAt={secondary.generatedAt} dataState={secondary.dataState} />
    </Card>
  );
}
