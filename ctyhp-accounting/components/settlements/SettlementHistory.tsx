"use client";
import { Alert, Space, Table, Tag, Typography } from "antd";
import { formatMoney } from "@/lib/format";
import {
  buildSettlementHistory,
  settlementTypeLabel,
  type SettlementEvent,
  type SettlementLine,
} from "@/lib/domain/settlement";

const TYPE_COLOR: Record<string, string> = {
  payment: "green",
  credit_memo: "blue",
  vendor_credit: "blue",
  write_off: "orange",
};

/**
 * What has settled a document, oldest first, with the balance after each one.
 *
 * Shown on the document rather than in a report: the first question about an
 * unpaid invoice is "what has been paid on it", and the answer used to live in
 * three tables no screen joined.
 */
export default function SettlementHistory({
  totalMinor,
  balanceDueMinor,
  currencyCode,
  decimals,
  events,
  loading,
  emptyText = "Nothing has been paid against this document yet.",
}: {
  totalMinor: number;
  balanceDueMinor: number;
  currencyCode: string;
  decimals: number;
  events: SettlementEvent[];
  loading: boolean;
  emptyText?: string;
}) {
  const history = buildSettlementHistory({ totalMinor, balanceDueMinor, events });
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Space size="large" wrap>
        <Typography.Text strong>Payments &amp; settlements</Typography.Text>
        <Typography.Text type="secondary">
          Invoiced {money(totalMinor)} · settled {money(history.settledMinor)} · outstanding{" "}
          <b>{money(history.balanceDueMinor)}</b>
        </Typography.Text>
      </Space>

      {!history.reconciles ? (
        <Alert
          type="warning"
          showIcon
          message="The settlements listed here do not add up to the outstanding balance"
          description="Something has changed this document's balance outside payments, credits and write-offs. Check the change history before relying on either figure."
        />
      ) : null}

      <Table<SettlementLine>
        rowKey={(row) => `${row.settlementType}-${row.documentNumber}-${row.settledOn}`}
        size="small"
        loading={loading}
        pagination={false}
        dataSource={history.lines}
        locale={{ emptyText }}
        columns={[
          { title: "Date", dataIndex: "settledOn", width: 110 },
          {
            title: "Type",
            dataIndex: "settlementType",
            width: 130,
            render: (type: string) => (
              <Tag color={TYPE_COLOR[type]}>{settlementTypeLabel(type as "payment")}</Tag>
            ),
          },
          { title: "Number", dataIndex: "documentNumber", width: 140, render: (v: string | null) => v ?? "—" },
          { title: "Method", dataIndex: "method", width: 110, render: (v: string | null) => v ?? "—" },
          {
            title: "Journal entry",
            dataIndex: "entryNumber",
            width: 140,
            render: (v: string | null) => v ?? "—",
          },
          {
            title: "Reference",
            dataIndex: "reference",
            width: 130,
            render: (v: string | null) => v ?? "—",
          },
          {
            title: "Amount",
            dataIndex: "amountMinor",
            width: 120,
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Balance after",
            dataIndex: "balanceAfterMinor",
            width: 130,
            align: "right",
            render: (value: number) => money(value),
          },
        ]}
      />
    </Space>
  );
}
