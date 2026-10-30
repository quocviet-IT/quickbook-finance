"use client";
import { Segmented, Space, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import {
  AGING_BUCKETS,
  agingSummaryGrid,
  pivotAgingByParty,
  type AgingGridRow,
  type PartyAgingRow,
} from "@/lib/domain/aging";
import { formatDate } from "@/lib/format";
import type { AgingReportRow } from "@/lib/services/aging";

export type AgingGrouping = "grid" | "party" | "document";

/**
 * The by-party list: the five aging buckets and Total. The party takes what is
 * left, at least COLUMN.TEXT_MIN, with what it has overdue and its oldest due
 * date under the name. With Overdue as a seventh amount column the name had
 * 172px of 984 at 1280.
 */
export const AGING_PARTY_FIXED_WIDTHS = [
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
] as const;

/**
 * The aging report by customer or vendor: one row each, a column per bucket,
 * totals down the side and along the bottom.
 *
 * The document list answers "which invoices are late". This answers "who is
 * late", which is where a collections call or a payment run starts — and it is
 * the layout both reviewers asked for.
 */
export default function AgingByPartyTable({
  rows,
  partyLabel,
  money,
  grouping,
  onGroupingChange,
  documentColumns,
  emptyTitle,
  emptyDescription,
  loading,
  companyName,
  asOf,
}: {
  rows: AgingReportRow[];
  /** "Customer" or "Vendor" — the heading of the first column. */
  partyLabel: string;
  money: (minor: number) => string;
  grouping: AgingGrouping;
  onGroupingChange: (grouping: AgingGrouping) => void;
  documentColumns: React.ComponentProps<typeof DataTable<AgingReportRow>>["columns"];
  emptyTitle: string;
  emptyDescription: string;
  loading: boolean;
  /** Printed above the grid: a statement says whose books it is. */
  companyName: string;
  asOf: string;
}) {
  const pivot = pivotAgingByParty(rows);
  const grid = agingSummaryGrid(pivot);
  // Under the name rather than in a column of its own: an eighth amount
  // column left the name no room at 1280, and under Total it broke in two.
  const overdueLine = (overdueMinor: number, oldestDueDate: string | null) => {
    if (overdueMinor <= 0) return oldestDueDate ? secondaryLine(`Oldest due ${formatDate(oldestDueDate)}`) : null;
    const overdue = `${money(overdueMinor)} overdue`;
    return (
      <Typography.Text type="danger" style={{ display: "block", fontSize: 12 }}>
        {oldestDueDate ? `${overdue} · oldest due ${formatDate(oldestDueDate)}` : overdue}
      </Typography.Text>
    );
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Segmented
        value={grouping}
        onChange={(value) => onGroupingChange(value as AgingGrouping)}
        options={[
          { label: "Summary grid", value: "grid" },
          { label: `By ${partyLabel.toLowerCase()} (${pivot.rows.length})`, value: "party" },
          { label: `By document (${rows.length})`, value: "document" },
        ]}
      />

      {grouping === "grid" ? (
        <div className="aging-grid">
          <div className="aging-grid__heading">
            <div>
              <div className="report-result__entity">{companyName}</div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {partyLabel === "Vendor" ? "Accounts Payable" : "Accounts Receivable"} Aging
              </Typography.Title>
              <Typography.Text type="secondary">As of {formatDate(asOf)}</Typography.Text>
            </div>
          </div>
          {/* A matrix: one column per customer or vendor, as many as the data has, so
              the count cannot be designed to fit. Named in table-fit-contract.test.ts. */}
          <DataTable<AgingGridRow>
            fit={false}
            rowKey="key"
            loading={loading}
            pagination={false}
            rows={grid.rows}
            emptyTitle={emptyDescription}
            columns={[
              {
                title: partyLabel,
                dataIndex: "label",
                width: 130,
                fixed: "left",
                render: (label: string, row) =>
                  row.kind === "total" ? <b>{label}</b> : label,
              },
              ...grid.columns.map((column, index) => ({
                title: column.entityName,
                key: column.entityId,
                width: 140,
                align: "right" as const,
                render: (_: unknown, row: AgingGridRow) =>
                  row.kind === "total" ? (
                    <b>{money(row.amounts[index] ?? 0)}</b>
                  ) : (
                    money(row.amounts[index] ?? 0)
                  ),
              })),
              {
                title: "Total",
                key: "total",
                width: 150,
                align: "right",
                render: (_: unknown, row: AgingGridRow) => <b>{money(row.totalMinor)}</b>,
              },
            ]}
            rowClassName={(row) => (row.kind === "total" ? "report-table-row--emphasis" : "")}
          />
        </div>
      ) : grouping === "document" ? (
        <DataTable<AgingReportRow>
          rowKey={(row) => `${row.docType}-${row.docNumber}`}
          loading={loading}
          dataSource={rows}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          columns={documentColumns}
        />
      ) : (
        <ReportTable<PartyAgingRow>
          rowKey="entityId"
          loading={loading}
          rows={pivot.rows}
          pagination={false}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          columns={[
            flexColumn<PartyAgingRow>({
              title: partyLabel,
              dataIndex: "entityName",
              render: (_: unknown, row: PartyAgingRow) => (
                <>
                  <span title={row.entityName}>{row.entityName}</span>
                  {overdueLine(row.overdueMinor, row.oldestDueDate)}
                </>
              ),
            }),
            ...AGING_BUCKETS.map((bucket, index) => ({
              title: bucket.label,
              key: bucket.key,
              width: AGING_PARTY_FIXED_WIDTHS[index],
              align: "right" as const,
              render: (_: unknown, row: PartyAgingRow) => money(row.buckets[bucket.key] ?? 0),
            })),
            {
              title: "Total",
              key: "total",
              width: AGING_PARTY_FIXED_WIDTHS[5],
              align: "right",
              render: (_: unknown, row: PartyAgingRow) => <b>{money(row.totalMinor)}</b>,
            },
          ]}
          summary={() =>
            pivot.rows.length === 0 ? null : (
              <SummaryRow>
                <SummaryCell index={0}>
                  <b>Total</b>
                  {overdueLine(pivot.overdueMinor, null)}
                </SummaryCell>
                {AGING_BUCKETS.map((bucket, index) => (
                  <SummaryCell key={bucket.key} index={index + 1} align="right">
                    <b>{money(pivot.bucketTotals[bucket.key] ?? 0)}</b>
                  </SummaryCell>
                ))}
                <SummaryCell index={AGING_BUCKETS.length + 1} align="right">
                  <b>{money(pivot.totalMinor)}</b>
                </SummaryCell>
              </SummaryRow>
            )
          }
        />
      )}
    </Space>
  );
}
