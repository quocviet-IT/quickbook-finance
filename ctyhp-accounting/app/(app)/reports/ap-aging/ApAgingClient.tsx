"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Alert, Space, Tag, Typography } from "antd";
import { AgingComparisonChart } from "@/components/charts/FinancialCharts";
import { ReportBody } from "@/components/reports/ReportAudience";
import AgingByPartyTable, {
  type AgingGrouping,
} from "@/components/reports/AgingByPartyTable";
import ReportBar from "@/components/reports/ReportBar";
import { useCompanyClock } from "@/components/CompanyClock";
import { agingExportSheet } from "@/lib/domain/aging-export";
import { formatDate, formatMoney } from "@/lib/format";
import { apAgingAction } from "./actions";
import type { AgingReport } from "@/lib/services/aging";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
] as const;
const PARTY = "Vendor";

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
  const { today } = useCompanyClock();
  const [asOf, setAsOf] = useState(today);
  // The date the shown report was run for; the picker may have moved on since.
  const [ranAsOf, setRanAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The party view first: "who is late" is the question this report is
  // opened with; the document list is one click away.
  const [grouping, setGrouping] = useState<AgingGrouping>("grid");
  const fmt = (m: number) => formatMoney(m, baseCurrency, baseDecimals);

  const run = async () => {
    setLoading(true);
    const r = await apAgingAction(asOf);
    setLoading(false);
    if (r.ok && r.data) {
      setRep(r.data);
      setRanAsOf(asOf);
    } else message.error(r.error ?? "Failed");
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // Runs once on arrival; afterwards the date and Run report do it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheet = useMemo(
    () =>
      rep && ranAsOf
        ? agingExportSheet({
            grouping,
            rows: rep.rows,
            partyLabel: PARTY,
            companyName,
            asOf: ranAsOf,
            currencyCode: baseCurrency,
            baseDecimals,
          })
        : null,
    [rep, ranAsOf, grouping, companyName, baseCurrency, baseDecimals],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <ReportBar
        dates={{ kind: "asOf", to: asOf, onTo: setAsOf }}
        onRun={() => void run()}
        loading={loading}
        sheet={sheet}
        resultCount={rep?.rows.length}
      />
      {rep && ranAsOf && (
        <div className="report-print-area">
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Typography.Text type="secondary">
            Current open balances in {baseCurrency} · aged as of {formatDate(ranAsOf!)} · Accrual basis
          </Typography.Text>
          <Alert
            type={rep.reconciled ? "success" : "warning"}
            message={
              rep.reconciled
                ? `Reconciled to Accounts Payable control account: ${fmt(rep.total)}.`
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
                partyLabel={PARTY}
                money={(minor) => fmt(minor)}
                grouping={grouping}
                onGroupingChange={setGrouping}
                loading={loading}
                companyName={companyName}
                asOf={ranAsOf!}
                emptyTitle="No open payables"
                emptyDescription="There are no vendor balances outstanding as of this date."
                documentColumns={[
                  { title: "Vendor", dataIndex: "entityName" },
                  { title: "Type", dataIndex: "docType" },
                  { title: "Number", dataIndex: "docNumber" },
                  { title: "Due", dataIndex: "dueDate", render: (v: string) => formatDate(v) },
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
                formatMoney={fmt}
              />
            }
          />
        </Space>
        </div>
      )}
    </Space>
  );
}
