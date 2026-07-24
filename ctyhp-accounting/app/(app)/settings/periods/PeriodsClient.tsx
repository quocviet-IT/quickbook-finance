"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, Card, Input, InputNumber, Space, Table, Tag } from "antd";
import { listPeriodsAction, generatePeriodsAction, closePeriodAction, reopenPeriodAction } from "./actions";
import type { AccountingPeriodRow } from "@/lib/db/types";

export default function PeriodsClient({
  canEdit,
  fiscalStartMonth,
}: {
  canEdit: boolean;
  fiscalStartMonth: number;
}) {
  const { message, modal } = App.useApp();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<AccountingPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (fy: number) => {
    setLoading(true);
    const r = await listPeriodsAction(fy);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const generate = async () => {
    const r = await generatePeriodsAction(year);
    if (r.ok) {
      message.success(`Generated ${r.data?.created ?? 0} period(s)`);
      void load(year);
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const act = (row: AccountingPeriodRow, kind: "close" | "reopen") => {
    let reason = "";
    modal.confirm({
      title: `${kind === "close" ? "Close" : "Reopen"} ${row.label}?`,
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} />,
      onOk: async () => {
        const r = kind === "close" ? await closePeriodAction(row.id, { reason }) : await reopenPeriodAction(row.id, { reason });
        if (r.ok) {
          message.success(kind === "close" ? "Period closed" : "Period reopened");
          void load(year);
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <span>Fiscal year:</span>
        <InputNumber value={year} onChange={(v) => setYear((v as number) ?? year)} />
        <Tag>Fiscal year starts month {fiscalStartMonth}</Tag>
        {canEdit && (
          <Button type="primary" onClick={generate}>
            Generate periods
          </Button>
        )}
      </Space>
      <Table<AccountingPeriodRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "Period", dataIndex: "label" },
          { title: "Start", dataIndex: "period_start" },
          { title: "End", dataIndex: "period_end" },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={s === "closed" ? "red" : "green"}>{s}</Tag>,
          },
          {
            title: "",
            render: (_, r) =>
              canEdit ? (
                r.status === "open" ? (
                  <Button size="small" onClick={() => act(r, "close")}>
                    Close
                  </Button>
                ) : (
                  <Button size="small" onClick={() => act(r, "reopen")}>
                    Reopen
                  </Button>
                )
              ) : null,
          },
        ]}
      />
      <Card title="Closing checklist" size="small">
        <p>Review these controls before closing a period:</p>
        <ul>
          <li>
            <Link href="/reports/ar-ageing">
              Accounts Receivable ageing reconciles to the Accounts Receivable control account
            </Link>
          </li>
          <li>
            <Link href="/reports/ap-ageing">
              Accounts Payable ageing reconciles to the Accounts Payable control account
            </Link>
          </li>
          <li><Link href="/banking/reconcile">Bank accounts are reconciled</Link></li>
          <li><Link href="/sales-tax">Sales-tax liability is reviewed</Link></li>
        </ul>
      </Card>
    </Space>
  );
}
