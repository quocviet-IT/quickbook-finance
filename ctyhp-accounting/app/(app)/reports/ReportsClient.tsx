"use client";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, DatePicker, Segmented, Space, Table, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { formatMoney } from "@/lib/format";
import {
  buildTrialBalance,
  buildProfitAndLoss,
  buildBalanceSheet,
  type LedgerBalance,
  type ReportSection,
} from "@/lib/domain/reports";
import { getLedgerBalancesAction } from "./actions";

type ReportType = "trial" | "pnl" | "balance";

export default function ReportsClient({
  baseCurrency,
  baseDecimals,
}: {
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [type, setType] = useState<ReportType>("trial");
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf("year"), dayjs()]);
  const [rows, setRows] = useState<LedgerBalance[]>([]);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) => formatMoney(minor, baseCurrency, baseDecimals),
    [baseCurrency, baseDecimals],
  );

  const run = useCallback(async () => {
    setLoading(true);
    const from = type === "pnl" ? range[0].format("YYYY-MM-DD") : null;
    const to = type === "pnl" ? range[1].format("YYYY-MM-DD") : asOf.format("YYYY-MM-DD");
    const res = await getLedgerBalancesAction(from, to);
    setLoading(false);
    if (res.ok && res.data) setRows(res.data);
    else message.error(res.error ?? "Failed to load report");
  }, [type, asOf, range, message]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={type}
          onChange={(v) => setType(v as ReportType)}
          options={[
            { label: "Trial Balance", value: "trial" },
            { label: "Profit & Loss", value: "pnl" },
            { label: "Balance Sheet", value: "balance" },
          ]}
        />
        {type === "pnl" ? (
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => v && setRange([v[0]!, v[1]!])}
          />
        ) : (
          <Space>
            <Typography.Text type="secondary">As of</Typography.Text>
            <DatePicker value={asOf} allowClear={false} onChange={(v) => v && setAsOf(v)} />
          </Space>
        )}
        <Button type="primary" onClick={run} loading={loading}>
          Run
        </Button>
      </Space>

      <Card loading={loading}>
        {type === "trial" && <TrialBalanceView rows={rows} money={money} asOf={asOf} />}
        {type === "pnl" && <PnlView rows={rows} money={money} range={range} />}
        {type === "balance" && <BalanceSheetView rows={rows} money={money} asOf={asOf} />}
      </Card>
    </div>
  );
}

function ReportTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 16 }}>
      <Typography.Title level={4} style={{ marginBottom: 2 }}>
        {title}
      </Typography.Title>
      <Typography.Text type="secondary">{subtitle}</Typography.Text>
    </div>
  );
}

function TrialBalanceView({
  rows,
  money,
  asOf,
}: {
  rows: LedgerBalance[];
  money: (n: number) => string;
  asOf: Dayjs;
}) {
  const tb = buildTrialBalance(rows);
  return (
    <div>
      <ReportTitle title="Trial Balance" subtitle={`As of ${asOf.format("MMM D, YYYY")}`} />
      <Table
        rowKey="accountCode"
        size="small"
        pagination={false}
        dataSource={tb.lines}
        columns={[
          { title: "Account", render: (_, r) => `${r.accountCode} — ${r.name}` },
          { title: "Debit", dataIndex: "debit", align: "right", width: 160, render: (v: number) => (v ? money(v) : "") },
          { title: "Credit", dataIndex: "credit", align: "right", width: 160, render: (v: number) => (v ? money(v) : "") },
        ]}
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600, background: "#f8fafc" }}>
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">{money(tb.totalDebit)}</Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">{money(tb.totalCredit)}</Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Tag color={tb.balanced ? "green" : "red"}>{tb.balanced ? "Balanced" : "Out of balance"}</Tag>
      </div>
    </div>
  );
}

function StatementRows({
  section,
  money,
  indent = 0,
}: {
  section: ReportSection;
  money: (n: number) => string;
  indent?: number;
}) {
  return (
    <>
      <Row label={section.title} bold />
      {section.lines.map((l, i) => (
        <Row key={l.accountCode + i} label={`${l.accountCode ? l.accountCode + " — " : ""}${l.name}`} value={money(l.amount)} indent={indent + 1} />
      ))}
      <Row label={`Total ${section.title}`} value={money(section.total)} indent={indent} subtotal />
    </>
  );
}

function Row({
  label,
  value,
  bold,
  subtotal,
  emphasize,
  indent = 0,
}: {
  label: string;
  value?: string;
  bold?: boolean;
  subtotal?: boolean;
  emphasize?: boolean;
  indent?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 4px",
        paddingLeft: 4 + indent * 20,
        borderTop: subtotal || emphasize ? "1px solid #e5e7eb" : undefined,
        fontWeight: bold || subtotal || emphasize ? 600 : 400,
        fontSize: emphasize ? 15 : 14,
        background: emphasize ? "#f8fafc" : undefined,
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function PnlView({
  rows,
  money,
  range,
}: {
  rows: LedgerBalance[];
  money: (n: number) => string;
  range: [Dayjs, Dayjs];
}) {
  const p = buildProfitAndLoss(rows);
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <ReportTitle
        title="Profit & Loss"
        subtitle={`${range[0].format("MMM D, YYYY")} – ${range[1].format("MMM D, YYYY")}`}
      />
      <StatementRows section={p.income} money={money} />
      <StatementRows section={p.costOfGoodsSold} money={money} />
      <Row label="Gross Profit" value={money(p.grossProfit)} emphasize />
      <StatementRows section={p.operatingExpenses} money={money} />
      <StatementRows section={p.otherIncome} money={money} />
      <StatementRows section={p.otherExpenses} money={money} />
      <Row label="Net Income" value={money(p.netIncome)} emphasize />
    </div>
  );
}

function BalanceSheetView({
  rows,
  money,
  asOf,
}: {
  rows: LedgerBalance[];
  money: (n: number) => string;
  asOf: Dayjs;
}) {
  const bs = buildBalanceSheet(rows);
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <ReportTitle title="Balance Sheet" subtitle={`As of ${asOf.format("MMM D, YYYY")}`} />
      <StatementRows section={bs.assets} money={money} />
      <Row label="Total Assets" value={money(bs.totalAssets)} emphasize />
      <div style={{ height: 12 }} />
      <StatementRows section={bs.liabilities} money={money} />
      <StatementRows section={bs.equity} money={money} />
      <Row label="Total Liabilities + Equity" value={money(bs.totalLiabilities + bs.totalEquity)} emphasize />
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Tag color={bs.balanced ? "green" : "red"}>{bs.balanced ? "Balanced" : "Out of balance"}</Tag>
      </div>
    </div>
  );
}
