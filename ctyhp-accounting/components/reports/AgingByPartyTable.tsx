"use client";
import { Segmented, Space, Table, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  AGING_BUCKETS,
  pivotAgingByParty,
  type PartyAgingRow,
} from "@/lib/domain/aging";
import type { AgingReportRow } from "@/lib/services/aging";

export type AgingGrouping = "party" | "document";

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
}) {
  const pivot = pivotAgingByParty(rows);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Segmented
        value={grouping}
        onChange={(value) => onGroupingChange(value as AgingGrouping)}
        options={[
          { label: `By ${partyLabel.toLowerCase()} (${pivot.rows.length})`, value: "party" },
          { label: `By document (${rows.length})`, value: "document" },
        ]}
      />

      {grouping === "document" ? (
        <DataTable<AgingReportRow>
          rowKey={(row) => `${row.docType}-${row.docNumber}`}
          loading={loading}
          dataSource={rows}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          columns={documentColumns}
        />
      ) : (
        <DataTable<PartyAgingRow>
          rowKey="entityId"
          loading={loading}
          dataSource={pivot.rows}
          pagination={false}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          columns={[
            {
              title: partyLabel,
              dataIndex: "entityName",
              render: (name: string, row) =>
                row.oldestDueDate ? (
                  <Space size="small">
                    {name}
                    <Tag color="red">oldest due {row.oldestDueDate}</Tag>
                  </Space>
                ) : (
                  name
                ),
            },
            ...AGING_BUCKETS.map((bucket) => ({
              title: bucket.label,
              key: bucket.key,
              width: 120,
              align: "right" as const,
              render: (_: unknown, row: PartyAgingRow) => money(row.buckets[bucket.key] ?? 0),
            })),
            {
              title: "Overdue",
              key: "overdue",
              width: 130,
              align: "right",
              render: (_: unknown, row: PartyAgingRow) =>
                row.overdueMinor > 0 ? (
                  <Typography.Text type="danger">{money(row.overdueMinor)}</Typography.Text>
                ) : (
                  money(0)
                ),
            },
            {
              title: "Total",
              key: "total",
              width: 140,
              align: "right",
              render: (_: unknown, row: PartyAgingRow) => <b>{money(row.totalMinor)}</b>,
            },
          ]}
          summary={() =>
            pivot.rows.length === 0 ? null : (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <b>Total</b>
                </Table.Summary.Cell>
                {AGING_BUCKETS.map((bucket, index) => (
                  <Table.Summary.Cell key={bucket.key} index={index + 1} align="right">
                    <b>{money(pivot.bucketTotals[bucket.key] ?? 0)}</b>
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={AGING_BUCKETS.length + 1} align="right">
                  <b>{money(pivot.overdueMinor)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={AGING_BUCKETS.length + 2} align="right">
                  <b>{money(pivot.totalMinor)}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )
          }
        />
      )}
    </Space>
  );
}
