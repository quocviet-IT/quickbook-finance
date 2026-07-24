"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { fromMinor } from "@/lib/domain/money";
import { apAgeingAction } from "./actions";
import type { AgeingReport, AgeingReportRow } from "@/lib/services/ageing";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
] as const;

export default function ApAgeingClient({ baseCurrency, baseDecimals }: { baseCurrency: string; baseDecimals: number }) {
  const { message } = App.useApp();
  const [rep, setRep] = useState<AgeingReport | null>(null);
  const [asOf, setAsOf] = useState<Dayjs | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!asOf) {
      message.warning("Pick an as-of date");
      return;
    }
    setLoading(true);
    const r = await apAgeingAction(asOf.format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space>
        <DatePicker value={asOf} onChange={setAsOf} placeholder="As of" />
        <Button type="primary" loading={loading} onClick={run}>
          Run
        </Button>
      </Space>
      {rep && (
        <>
          <Typography.Text type="secondary">
            Current open balances in {baseCurrency} · aged as of {asOf!.format("YYYY-MM-DD")} · Accrual basis
          </Typography.Text>
          <Alert
            type={rep.reconciled ? "success" : "warning"}
            message={
              rep.reconciled
                ? `Reconciled to Accounts Payable control account: ${fmt(rep.total)} ${baseCurrency}.`
                : `Ageing total ${fmt(rep.total)} does not match AP control ${fmt(rep.controlBalanceMinor)} — investigate.`
            }
          />
          <Space size="large">
            {BUCKETS.map(([k, label]) => (
              <Tag key={k}>
                {label}: {fmt(rep.buckets[k])}
              </Tag>
            ))}
            <b>Total: {fmt(rep.total)}</b>
          </Space>
          <Table<AgeingReportRow>
            rowKey={(r) => `${r.docType}-${r.docNumber}`}
            loading={loading}
            dataSource={rep.rows}
            columns={[
              { title: "Vendor", dataIndex: "entityName" },
              { title: "Type", dataIndex: "docType" },
              { title: "Number", dataIndex: "docNumber" },
              { title: "Due", dataIndex: "dueDate" },
              { title: "Bucket", dataIndex: "bucket" },
              { title: "Balance", align: "right", render: (_, r) => fmt(r.balanceMinor) },
            ]}
          />
        </>
      )}
    </Space>
  );
}
