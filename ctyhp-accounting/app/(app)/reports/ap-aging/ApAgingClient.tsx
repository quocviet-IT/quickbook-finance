"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { AgingComparisonChart } from "@/components/charts/FinancialCharts";
import { ReportBody } from "@/components/reports/ReportAudience";
import AgingByPartyTable, {
  type AgingGrouping,
} from "@/components/reports/AgingByPartyTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { apAgingAction } from "./actions";
import type { AgingReport } from "@/lib/services/aging";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
] as const;

export default function ApAgingClient({
  baseCurrency,
  baseDecimals,
  companyName,
}: {
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
}) {
  const { message } = App.useApp();
  const [rep, setRep] = useState<AgingReport | null>(null);
  const [asOf, setAsOf] = useState<Dayjs | null>(null);
  const [loading, setLoading] = useState(false);
  // The party view first: "who is late" is the question this report is
  // opened with; the document list is one click away.
  const [grouping, setGrouping] = useState<AgingGrouping>("grid");
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!asOf) {
      message.warning("Pick an as-of date");
      return;
    }
    setLoading(true);
    const r = await apAgingAction(asOf.format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={rep?.rows.length}
        ariaLabel="Accounts Payable aging filters"
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
                ? `Reconciled to Accounts Payable control account: ${fmt(rep.total)} ${baseCurrency}.`
                : `Aging total ${fmt(rep.total)} does not match Accounts Payable control ${fmt(rep.controlBalanceMinor)} — investigate.`
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
          <ReportBody
            numbers={
              <AgingByPartyTable
                rows={rep.rows}
                partyLabel="Vendor"
                money={(minor) => fmt(minor)}
                grouping={grouping}
                onGroupingChange={setGrouping}
                loading={loading}
                companyName={companyName}
                asOf={asOf!.format("YYYY-MM-DD")}
                currencyCode={baseCurrency}
                baseDecimals={baseDecimals}
                emptyTitle="No open payables"
                emptyDescription="There are no vendor balances outstanding as of this date."
                documentColumns={[
                  { title: "Vendor", dataIndex: "entityName" },
                  { title: "Type", dataIndex: "docType" },
                  { title: "Number", dataIndex: "docNumber" },
                  { title: "Due", dataIndex: "dueDate" },
                  { title: "Bucket", dataIndex: "bucket" },
                  { title: "Balance", align: "right", render: (_, r) => fmt(r.balanceMinor) },
                ]}
              />
            }
            chart={
              <AgingComparisonChart
                payables={{
                  current: rep.buckets.current ?? 0,
                  d1_30: rep.buckets.d1_30 ?? 0,
                  d31_60: rep.buckets.d31_60 ?? 0,
                  d61_90: rep.buckets.d61_90 ?? 0,
                  d90_plus: rep.buckets.d90_plus ?? 0,
                }}
                formatMoney={(value) => `${fmt(value)} ${baseCurrency}`}
              />
            }
          />
        </>
      )}
    </Space>
  );
}
