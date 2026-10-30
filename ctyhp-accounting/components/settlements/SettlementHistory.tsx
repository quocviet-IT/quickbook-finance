"use client";
import { Alert, Space, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatDate, formatMoney } from "@/lib/format";
import { humanizeStatus } from "@/lib/domain/status-label";
import {
  buildSettlementHistory,
  settlementTypeLabel,
  type SettlementEvent,
  type SettlementLine,
} from "@/lib/domain/settlement";

/**
 * Date, Journal entry, Amount and Balance after. Settlement takes what is
 * left, at least COLUMN.RICH_MIN: its type and number, and under them how it
 * was paid and its reference. Shown in the invoice and bill dialogs (820 and
 * 860px wide), whose bodies are 772 and 812. Type, Number, Method and
 * Reference were four columns of their own, 998px with Reference at its floor,
 * so the dialog scrolled sideways for a list of at most a few lines.
 */
export const SETTLEMENT_HISTORY_FIXED_WIDTHS = [
  COLUMN.DATE,
  COLUMN.CODE,
  COLUMN.MONEY,
  COLUMN.MONEY_WIDE,
] as const;

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

      <DataTable<SettlementLine>
        rowKey={(row) => `${row.settlementType}-${row.documentNumber}-${row.settledOn}`}
        loading={loading}
        pagination={false}
        rows={history.lines}
        locale={{ emptyText }}
        columns={[
          { title: "Date", dataIndex: "settledOn", width: SETTLEMENT_HISTORY_FIXED_WIDTHS[0], render: (v: string) => formatDate(v) },
          flexColumn<SettlementLine>({
            title: "Settlement",
            key: "settlement",
            floor: COLUMN.RICH_MIN,
            render: (_: unknown, row: SettlementLine) => {
              // How it was paid and the reference are facts about this one
              // settlement rather than columns anybody scans down.
              const facts = [row.method ? humanizeStatus(row.method) : null, row.reference].filter(Boolean).join(" · ");
              return (
                <>
                  <Space size={6}>
                    <Tag color={TYPE_COLOR[row.settlementType]}>{settlementTypeLabel(row.settlementType)}</Tag>
                    <span>{row.documentNumber ?? "—"}</span>
                  </Space>
                  {facts ? secondaryLine(facts) : null}
                </>
              );
            },
          }),
          {
            title: "Journal entry",
            dataIndex: "entryNumber",
            width: SETTLEMENT_HISTORY_FIXED_WIDTHS[1],
            render: (v: string | null) => v ?? "—",
          },
          {
            title: "Amount",
            dataIndex: "amountMinor",
            width: SETTLEMENT_HISTORY_FIXED_WIDTHS[2],
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Balance after",
            dataIndex: "balanceAfterMinor",
            width: SETTLEMENT_HISTORY_FIXED_WIDTHS[3],
            align: "right",
            render: (value: number) => money(value),
          },
        ]}
      />
    </Space>
  );
}
