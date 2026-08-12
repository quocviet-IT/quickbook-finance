"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DatePicker, Input, Select, Space, Statistic, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import {
  buildTransactionListSheet,
  filterTransactionList,
  NO_PARTY,
  transactionListChoices,
  transactionListTotals,
  type TransactionListFilter,
  type TransactionListRow,
} from "@/lib/domain/transaction-list";
import { formatMoney } from "@/lib/format";
import { TOKENS } from "@/lib/design/tokens";

const NO_FILTER: TransactionListFilter = {
  party: null,
  accountId: null,
  sourceType: null,
  reconciled: "all",
  search: "",
};

function documentTypeLabel(sourceType: string): string {
  return sourceType.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export default function TransactionListClient({
  rows,
  from,
  to,
  companyName,
  baseCurrency,
  baseDecimals,
  accountNames,
}: {
  rows: TransactionListRow[];
  from: string;
  to: string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  /** Account id to "code — name", for labelling the account filter. */
  accountNames: Record<string, string>;
}) {
  const router = useRouter();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(from), dayjs(to)]);
  const [filter, setFilter] = useState<TransactionListFilter>(NO_FILTER);

  const choices = useMemo(() => transactionListChoices(rows), [rows]);
  const visible = useMemo(() => filterTransactionList(rows, filter), [rows, filter]);

  const narrowed =
    filter.party !== null ||
    filter.accountId !== null ||
    filter.sourceType !== null ||
    filter.reconciled !== "all" ||
    filter.search.trim() !== "";

  // The figures and the export follow what is on screen. An export that does
  // not match the table is how a report stops being believed.
  const totals = transactionListTotals(visible);
  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  const set = <K extends keyof TransactionListFilter>(
    key: K,
    value: TransactionListFilter[K],
  ) => setFilter((previous) => ({ ...previous, [key]: value }));

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
          <Statistic title="Money in" value={money(totals.inMinor)} valueStyle={{ color: TOKENS.money.positive }} />
        </Card>
        <Card size="small">
          <Statistic title="Money out" value={money(totals.outMinor)} valueStyle={{ color: TOKENS.money.negative }} />
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

          <Input.Search
            allowClear
            placeholder="Search description, number, name"
            style={{ width: 260 }}
            value={filter.search}
            onChange={(event) => set("search", event.target.value)}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Filter by customer or vendor"
            placeholder="Customer or vendor"
            style={{ minWidth: 210 }}
            value={filter.party ?? undefined}
            onChange={(value) => set("party", value ?? null)}
            options={[
              ...choices.parties.map((party) => ({ value: party, label: party })),
              { value: NO_PARTY, label: "— No customer or vendor —" },
            ]}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Filter by account"
            placeholder="Account"
            style={{ minWidth: 240 }}
            value={filter.accountId ?? undefined}
            onChange={(value) => set("accountId", value ?? null)}
            options={choices.accountIds.map((id) => ({
              value: id,
              label: accountNames[id] ?? "An account no longer in the chart",
            }))}
          />
          <Select
            allowClear
            aria-label="Filter by document type"
            placeholder="Document type"
            style={{ minWidth: 170 }}
            value={filter.sourceType ?? undefined}
            onChange={(value) => set("sourceType", value ?? null)}
            options={choices.sourceTypes.map((type) => ({
              value: type,
              label: documentTypeLabel(type),
            }))}
          />
          <Select
            aria-label="Filter by reconciled"
            value={filter.reconciled}
            style={{ minWidth: 170 }}
            onChange={(value) => set("reconciled", value)}
            options={[
              { value: "all", label: "All transactions" },
              { value: "no", label: "Not reconciled" },
              { value: "yes", label: "Reconciled" },
            ]}
          />
          {narrowed ? (
            <Space size={8}>
              <Button onClick={() => setFilter(NO_FILTER)}>Clear filters</Button>
              <Typography.Text type="secondary">
                Showing {visible.length} of {rows.length}
              </Typography.Text>
            </Space>
          ) : null}
        </Space>
      </FilterBar>

      <DataTable<TransactionListRow>
        rowKey="entryId"
        dataSource={visible}
        pagination={{ pageSize: 50 }}
        sticky
        emptyTitle={narrowed ? "Nothing matches these filters" : "No transactions in this range"}
        emptyDescription={
          narrowed
            ? "Clear a filter, or widen the dates."
            : "Widen the dates, or post a document to see it here."
        }
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
              <span style={{ color: amount < 0 ? TOKENS.money.negative : TOKENS.money.positive }}>{money(amount)}</span>
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
