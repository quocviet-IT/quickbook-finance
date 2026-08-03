"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DatePicker, Select, Space, Statistic, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import {
  buildTransactionListSheet,
  transactionListTotals,
  type TransactionListRow,
} from "@/lib/domain/transaction-list";
import { formatMoney } from "@/lib/format";

export default function TransactionListClient({
  rows,
  from,
  to,
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  rows: TransactionListRow[];
  from: string;
  to: string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const router = useRouter();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(from), dayjs(to)]);
  const [reconciledFilter, setReconciledFilter] = useState<"all" | "yes" | "no">("all");

  const visible = useMemo(
    () =>
      reconciledFilter === "all"
        ? rows
        : rows.filter((row) => row.reconciled === (reconciledFilter === "yes")),
    [rows, reconciledFilter],
  );

  const totals = transactionListTotals(visible);
  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  // The range is a server round-trip because the range is what the query is;
  // filtering it in the browser would only ever hide rows already fetched.
  function applyRange() {
    const next = new URLSearchParams({
      from: range[0].format("YYYY-MM-DD"),
      to: range[1].format("YYYY-MM-DD"),
    });
    router.push(`/reports/transactions?${next.toString()}`);
  }

  const sheet = buildTransactionListSheet({
    rows: visible,
    companyName,
    from,
    to,
    currencyCode: baseCurrency,
  });

  return (
    <>
      <Space size="middle" wrap style={{ marginBottom: 16 }}>
        <Card size="small">
          <Statistic title="Transactions" value={totals.count} />
        </Card>
        <Card size="small">
          <Statistic title="Money in" value={money(totals.inMinor)} valueStyle={{ color: "#15803d" }} />
        </Card>
        <Card size="small">
          <Statistic title="Money out" value={money(totals.outMinor)} valueStyle={{ color: "#b91c1c" }} />
        </Card>
        <Card size="small">
          <Statistic title="Net" value={money(totals.netMinor)} />
        </Card>
        <Card size="small">
          <Statistic title="Not reconciled" value={totals.unreconciled} />
        </Card>
      </Space>

      <FilterBar
        resultCount={visible.length}
        actions={<ReportExportButtons sheet={sheet} disabled={visible.length === 0} />}
      >
        <Space wrap>
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setRange([value[0], value[1]]);
            }}
          />
          <Button type="primary" onClick={applyRange}>
            Apply
          </Button>
          <Select
            aria-label="Filter by reconciled"
            value={reconciledFilter}
            style={{ minWidth: 170 }}
            onChange={setReconciledFilter}
            options={[
              { value: "all", label: "All transactions" },
              { value: "no", label: "Not reconciled" },
              { value: "yes", label: "Reconciled" },
            ]}
          />
        </Space>
      </FilterBar>

      <DataTable<TransactionListRow>
        rowKey="entryId"
        dataSource={visible}
        pagination={{ pageSize: 50 }}
        sticky
        emptyTitle="No transactions in this range"
        emptyDescription="Widen the dates, or post a document to see it here."
        columns={[
          { title: "Date", dataIndex: "entryDate", width: 115 },
          {
            title: "Vendor/Customer Name",
            dataIndex: "partyName",
            width: 210,
            render: (name: string | null) =>
              name ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "Description",
            dataIndex: "description",
            render: (description: string, row) => (
              <Space direction="vertical" size={0}>
                <span>{description}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.entryNumber} · {row.sourceType.replaceAll("_", " ")}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "Account Type",
            dataIndex: "categoryLabel",
            width: 210,
            render: (label: string | null) =>
              label ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "Bank or Credit Card",
            dataIndex: "moneyLabel",
            width: 200,
            render: (label: string | null) =>
              label ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "Amount",
            dataIndex: "amountMinor",
            width: 150,
            align: "right",
            render: (amount: number) => (
              <span style={{ color: amount < 0 ? "#b91c1c" : "#15803d" }}>{money(amount)}</span>
            ),
          },
          {
            title: "Reconciled",
            dataIndex: "reconciled",
            width: 120,
            render: (reconciled: boolean) =>
              reconciled ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>,
          },
        ]}
      />
    </>
  );
}
