"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import { fromMinor } from "@/lib/domain/money";
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
  baseDecimals,
  onPayVendor,
}: {
  baseDecimals: number;
  /** Opens the existing payment dialog for a vendor. */
  onPayVendor?: (vendorId: string) => void;
}) {
  const { message } = App.useApp();
  const [run, setRun] = useState<PayRun | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await payRunAction();
    setLoading(false);
    if (res.ok && res.data) setRun(res.data);
    else message.error(res.error ?? "Failed to build the pay run");
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
        locale={{ emptyText: "No open bills — nothing to pay." }}
        rowClassName={(row) => (row.priority === "overdue" ? "report-table-row--exception" : "")}
        columns={[
          {
            title: "Priority",
            dataIndex: "priority",
            width: 150,
            render: (value: PayPriority) => (
              <Tag color={PRIORITY_COLOR[value]}>{PRIORITY_LABEL[value]}</Tag>
            ),
          },
          { title: "Vendor", dataIndex: "vendorName" },
          {
            title: "Bill",
            dataIndex: "billNumber",
            width: 130,
            render: (value: string | null) => value ?? <i>unnumbered</i>,
          },
          {
            title: "Terms",
            dataIndex: "termsLabel",
            width: 110,
            render: (value: string | null) => value ?? "—",
          },
          { title: "Due", dataIndex: "dueDate", width: 110, render: (v: string | null) => v ?? "—" },
          {
            title: "Why",
            dataIndex: "reason",
            render: (value: string, row) =>
              row.priority === "overdue" ? (
                <Typography.Text type="danger">{value}</Typography.Text>
              ) : (
                value
              ),
          },
          {
            title: "Balance",
            dataIndex: "balanceDueMinor",
            width: 130,
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Pay today",
            key: "payToday",
            width: 150,
            align: "right",
            render: (_: unknown, row) =>
              row.discountAvailableMinor > 0 ? (
                <Tooltip
                  title={`Settles the bill in full: ${money(row.balanceDueMinor)} less a ${money(
                    row.discountAvailableMinor,
                  )} discount, if paid by ${row.discountDueDate}`}
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
                  width: 90,
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
