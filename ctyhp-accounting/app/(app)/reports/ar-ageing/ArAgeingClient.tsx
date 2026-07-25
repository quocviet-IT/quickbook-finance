"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { arAgeingAction } from "./actions";
import type { AgeingReport, AgeingReportRow } from "@/lib/services/ageing";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
] as const;

export default function ArAgeingClient({ baseCurrency, baseDecimals }: { baseCurrency: string; baseDecimals: number }) {
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
    const r = await arAgeingAction(asOf.format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={rep?.rows.length}
        ariaLabel="Accounts Receivable ageing filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Run report
          </Button>
        }
      >
        <DatePicker value={asOf} onChange={setAsOf} placeholder="As of" />
      </FilterBar>
      {rep && (
        <>
          <Typography.Text type="secondary">
            Current open balances in {baseCurrency} · aged as of {asOf!.format("YYYY-MM-DD")} · Accrual basis
          </Typography.Text>
          <Alert
            type={rep.reconciled ? "success" : "warning"}
            message={
              rep.reconciled
                ? `Reconciled to Accounts Receivable control account: ${fmt(rep.total)} ${baseCurrency}.`
                : `Ageing total ${fmt(rep.total)} does not match Accounts Receivable control ${fmt(rep.controlBalanceMinor)} — investigate.`
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
          <DataTable<AgeingReportRow>
            rowKey={(r) => `${r.docType}-${r.docNumber}`}
            loading={loading}
            dataSource={rep.rows}
            emptyTitle="No open receivables"
            emptyDescription="There are no customer balances outstanding as of this date."
            columns={[
              { title: "Customer", dataIndex: "entityName" },
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
