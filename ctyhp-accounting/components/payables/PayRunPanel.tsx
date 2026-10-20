"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import TableEmpty from "@/components/ui/TableEmpty";
import { formatDate, formatMoney } from "@/lib/format";
import {
  DISCOUNT_WARNING_DAYS,
  describePayRun,
  PRIORITY_LABEL,
  type PayPriority,
  type PayRun,
  type RankedBill,
} from "@/lib/domain/payment-terms";
import { payRunAction } from "@/app/(app)/bills/actions";
import { TOKENS } from "@/lib/design/tokens";
import { statusToken } from "@/lib/design/status";
import { COLUMN } from "@/lib/design/table-metrics";
import { flexColumn, secondaryLine } from "@/components/ui/columns";

/** Vendor and Why share what the fixed columns leave: 962px in all at 1280, inside the 984 a table has. */
const TEXT_FLOOR = 160;

const PRIORITY_COLOR: Record<PayPriority, string> = {
  overdue: "red",
  discount_expiring: "gold",
  due_soon: "blue",
  scheduled: "default",
};

/**
 * What to pay next, and why.
 *
 * A list of bills sorted by date does not answer the question anyone actually
 * has when they sit down to pay suppliers. This ranks them: what is late, what
 * has a discount about to lapse, what falls due this fortnight — with the
 * reason spelled out on every row.
 */
export default function PayRunPanel({
  baseCurrency,
  baseDecimals,
  onPayVendor,
  canEnterBills = false,
}: {
  baseCurrency: string;
  baseDecimals: number;
  /** Opens the existing payment dialog for a vendor. */
  onPayVendor?: (vendorId: string) => void;
  /** Whether an empty run offers to enter a bill. */
  canEnterBills?: boolean;
}) {
  const { message } = App.useApp();
  const [run, setRun] = useState<PayRun | null>(null);
  // Loading from the first render: the run is asked for once the page has
  // mounted, and until it answers the table has not found nothing. Starting
  // at false, it said "No open bills" for seconds over an overdue bill.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const money = useCallback(
    (minor: number) => formatMoney(minor, baseCurrency, baseDecimals),
    [baseCurrency, baseDecimals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await payRunAction();
    setLoading(false);
    if (res.ok && res.data) {
      setRun(res.data);
      setLoadError(null);
    } else {
      const error = res.error ?? "Failed to build the pay run";
      setLoadError(error);
      message.error(error);
    }
  }, [message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const warning = run ? describePayRun(run) : null;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {run ? (
        <Alert
          type={warning ? "warning" : "success"}
          showIcon
          message={warning ?? "Nothing is overdue and no discount is about to lapse."}
        />
      ) : null}

      {run ? (
        <Space size="large" wrap>
          <Statistic
            title="Overdue"
            value={money(run.totals.overdueMinor)}
            // The icon rides alongside the colour rather than instead of it: a
            // figure that is only red says nothing to a reader who cannot see
            // the red, or to anyone holding a printout.
            prefix={run.totals.overdueMinor > 0 ? statusToken("overdue").icon : undefined}
            valueStyle={run.totals.overdueMinor > 0 ? { color: statusToken("overdue").color } : undefined}
          />
          <Statistic title={`Due within ${DISCOUNT_WARNING_DAYS * 2} days`} value={money(run.totals.dueSoonMinor)} />
          <Statistic title="Scheduled" value={money(run.totals.scheduledMinor)} />
          <Statistic
            title="Discount still available"
            value={money(run.totals.discountAvailableMinor)}
            valueStyle={run.totals.discountAvailableMinor > 0 ? { color: TOKENS.intent.success } : undefined}
          />
          <Statistic title="Total owed" value={money(run.totals.totalMinor)} />
          <Button onClick={load} loading={loading}>
            Refresh
          </Button>
        </Space>
      ) : null}

      <Table<RankedBill>
        rowKey="billId"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={run?.rows ?? []}
        locale={{
          emptyText:
            loadError && !run ? (
              <TableEmpty
                title="The pay run could not be built"
                description={loadError}
                action={<Button onClick={load}>Try again</Button>}
              />
            ) : (
              <TableEmpty
                loading={loading || !run}
                title="No open bills"
                description="Nothing is owed to a vendor. A bill you enter is listed here, ranked by when it is due."
                action={
                  canEnterBills ? (
                    <Link href="/bills?new=1">
                      <Button icon={<PlusOutlined />}>Enter a bill</Button>
                    </Link>
                  ) : null
                }
              />
            ),
        }}
        rowClassName={(row) => (row.priority === "overdue" ? "report-table-row--exception" : "")}
        // Fixed columns take the kit's widths and the two text columns share the
        // rest. They were 870px of fixed widths, which left Vendor and Why 57px
        // each at 1280, where "overdue" broke into "overdu/e" (UI review,
        // 2026-10-19). Terms reads under the due date it explains.
        columns={[
          {
            title: "Priority",
            dataIndex: "priority",
            width: COLUMN.STATUS,
            render: (value: PayPriority) => (
              <Tag color={PRIORITY_COLOR[value]}>{PRIORITY_LABEL[value]}</Tag>
            ),
          },
          flexColumn<RankedBill>({ title: "Vendor", dataIndex: "vendorName", floor: TEXT_FLOOR }),
          {
            title: "Bill",
            dataIndex: "billNumber",
            width: COLUMN.CODE,
            render: (value: string | null) => value ?? <i>unnumbered</i>,
          },
          {
            title: "Due",
            dataIndex: "dueDate",
            width: COLUMN.DATE,
            render: (v: string | null, row) => (
              <div style={{ minWidth: 0 }}>
                {formatDate(v)}
                {row.termsLabel ? secondaryLine(row.termsLabel) : null}
              </div>
            ),
          },
          flexColumn<RankedBill>({
            title: "Why",
            dataIndex: "reason",
            floor: TEXT_FLOOR,
            render: (value: string, row) =>
              row.priority === "overdue" ? (
                <Typography.Text type="danger" title={value}>
                  {value}
                </Typography.Text>
              ) : (
                value
              ),
          }),
          {
            title: "Balance",
            dataIndex: "balanceDueMinor",
            width: COLUMN.MONEY,
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Pay today",
            key: "payToday",
            width: COLUMN.MONEY_WIDE,
            align: "right",
            render: (_: unknown, row) =>
              row.discountAvailableMinor > 0 ? (
                <Tooltip
                  title={`Settles the bill in full: ${money(row.balanceDueMinor)} less a ${money(
                    row.discountAvailableMinor,
                  )} discount, if paid by ${formatDate(row.discountDueDate)}`}
                >
                  <b style={{ color: TOKENS.intent.success }}>{money(row.payTodayMinor)}</b>
                </Tooltip>
              ) : (
                money(row.payTodayMinor)
              ),
          },
          ...(onPayVendor
            ? [
                {
                  title: "",
                  key: "action",
                  width: 64,
                  render: (_: unknown, row: RankedBill) => (
                    <Button size="small" type="link" onClick={() => onPayVendor(row.vendorId)}>
                      Pay
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Space>
  );
}
