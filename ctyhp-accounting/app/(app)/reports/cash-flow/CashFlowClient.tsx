"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Table, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { fromMinor } from "@/lib/domain/money";
import { cashFlowAction } from "./actions";
import type { CashFlowReport } from "@/lib/services/cashflow";

export default function CashFlowClient({ baseCurrency, baseDecimals }: { baseCurrency: string; baseDecimals: number }) {
  const { message } = App.useApp();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [rep, setRep] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!range) { message.warning("Pick a date range"); return; }
    setLoading(true);
    const r = await cashFlowAction({ from: range[0].format("YYYY-MM-DD"), to: range[1].format("YYYY-MM-DD") });
    setLoading(false);
    if (r.ok && r.data) setRep(r.data); else message.error(r.error ?? "Failed");
  };

  const rows = rep
    ? [
        { key: "operating", label: "Operating activities", amount: rep.operating },
        { key: "investing", label: "Investing activities", amount: rep.investing },
        { key: "financing", label: "Financing activities", amount: rep.financing },
        { key: "net", label: "Net change in cash", amount: rep.netChange },
      ]
    : [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
        />
        <Button type="primary" loading={loading} onClick={run}>Run</Button>
      </Space>
      {rep && (
        <>
          <Typography.Text type="secondary">Base currency {baseCurrency} · Direct method</Typography.Text>
          <Table
            rowKey="key"
            pagination={false}
            dataSource={rows}
            columns={[
              { title: "Activity", dataIndex: "label", render: (t, r) => (r.key === "net" ? <b>{t}</b> : t) },
              { title: "Amount", align: "right", render: (_, r) => (r.key === "net" ? <b>{fmt(r.amount)}</b> : fmt(r.amount)) },
            ]}
          />
          <Alert
            type={rep.tiesOut ? "success" : "warning"}
            message={
              `Opening ${fmt(rep.openingMinor)} + Net ${fmt(rep.netChange)} = Closing ${fmt(rep.closingMinor)} ${baseCurrency}` +
              (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")
            }
          />
        </>
      )}
    </Space>
  );
}
