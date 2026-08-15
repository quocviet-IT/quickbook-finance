"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Select, Space, Statistic, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { generalLedgerAction } from "./actions";
import type { GeneralLedger, GeneralLedgerRow } from "@/lib/services/journal";

interface Account {
  id: string;
  account_code: string;
  name: string;
}
interface Props {
  accounts: Account[];
  baseCurrency: string;
  baseDecimals: number;
  initialAccountId?: string;
  initialFrom?: string;
  initialTo?: string;
}

// Drill-down: map a posted line back to its source document route. Manual
// journal entries and opening balances have no external source document, so
// they render as plain (non-linked) text.
function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  const map: Record<string, string> = {
    invoice: "/invoices",
    payment: "/payments",
    bill: "/bills",
    expense: "/expenses",
    bill_payment: "/pay-bills",
    tax_payment: "/sales-tax",
    credit_memo: "/credit-memos",
    vendor_credit: "/vendor-credits",
    customer_refund: "/payments",
    write_off: "/journal",
    goods_receipt: "/purchase-orders",
    bill_variance: "/bills",
    inventory_adjustment: "/items",
  };
  const route = map[sourceType];
  return route ? `${route}?source=${sourceId}` : null;
}

export default function GeneralLedgerClient({
  accounts,
  baseCurrency,
  baseDecimals,
  initialAccountId,
  initialFrom,
  initialTo,
}: Props) {
  const { message } = App.useApp();
  const validInitialAccount = accounts.some((account) => account.id === initialAccountId)
    ? initialAccountId
    : undefined;
  const [accountId, setAccountId] = useState<string | undefined>(validInitialAccount);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    initialTo
      ? [dayjs(initialFrom ?? "2000-01-01"), dayjs(initialTo)]
      : null,
  );
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!accountId || !range) {
      message.warning("Pick an account and date range");
      return;
    }
    setLoading(true);
    const r = await generalLedgerAction(accountId, range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setGl(r.data);
    else message.error(r.error ?? "Failed to load");
  }, [accountId, range, message]);

  useEffect(() => {
    // Deep-linked report filters intentionally trigger the initial server load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (validInitialAccount && initialTo) void run();
  }, [validInitialAccount, initialTo, run]);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={gl?.rows.length}
        ariaLabel="General Ledger filters"
        actions={
          <Button type="primary" loading={loading} onClick={() => void run()}>
            Run report
          </Button>
        }
      >
        <Select
          showSearch
          style={{ width: 320 }}
          placeholder="Account"
          optionFilterProp="label"
          value={accountId}
          options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
          onChange={setAccountId}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => v && setRange([v[0]!, v[1]!])} />
      </FilterBar>
      {gl && (
        <>
          <Typography.Text type="secondary">
            {gl.accountCode} {gl.accountName} · Base currency {baseCurrency} · Accrual basis
          </Typography.Text>
          <Space size="large">
            <Statistic title="Opening" value={fmt(gl.openingMinor)} />
            <Statistic title="Closing" value={fmt(gl.closingMinor)} />
          </Space>
          <DataTable<GeneralLedgerRow>
            rowKey="lineId"
            dataSource={gl.rows}
            pagination={false}
            loading={loading}
            emptyTitle="No ledger activity"
            emptyDescription="No posted entries were found for this account and date range."
            // Every column but the memo is given a width, so the three money
            // columns keep their place at the right edge. Without this the memo
            // sets the table's width on its own: a bank memo carries the whole
            // wire description, several hundred characters of it, and the
            // amounts were pushed off the side of the screen. Zooming out did
            // not help, because the memo simply took the extra room too — which
            // is what a reader reported.
            //
            // `ellipsis` cuts the memo to its column and keeps the full text in
            // the cell's title, so it is still there on hover. It also switches
            // the table to a fixed layout, which is what makes the widths hold.
            columns={[
              { title: "Date", dataIndex: "entryDate", width: 110 },
              {
                title: "Entry",
                dataIndex: "entryNumber",
                width: 130,
                render: (number, row) => (
                  <Link href={`/reports/journal?entry=${row.entryId}`}>{number}</Link>
                ),
              },
              {
                title: "Source",
                dataIndex: "sourceType",
                width: 120,
                render: (source, row) => {
                  const href = sourceHref(row.sourceType, row.sourceId);
                  return href ? <Link href={href}>{source}</Link> : source;
                },
              },
              { title: "Memo", dataIndex: "memo", ellipsis: true },
              {
                title: "Debit",
                align: "right",
                width: 140,
                render: (_, r) => (r.debitMinor ? fmt(r.debitMinor) : ""),
              },
              {
                title: "Credit",
                align: "right",
                width: 140,
                render: (_, r) => (r.creditMinor ? fmt(r.creditMinor) : ""),
              },
              { title: "Running", align: "right", width: 150, render: (_, r) => fmt(r.runningMinor) },
            ]}
          />
        </>
      )}
    </Space>
  );
}
