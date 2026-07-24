"use client";
import { useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Select, Space, Statistic, Typography } from "antd";
import type { Dayjs } from "dayjs";
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
  };
  return map[sourceType] ?? null;
}

export default function GeneralLedgerClient({ accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [accountId, setAccountId] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!accountId || !range) {
      message.warning("Pick an account and date range");
      return;
    }
    setLoading(true);
    const r = await generalLedgerAction(accountId, range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setGl(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={gl?.rows.length}
        ariaLabel="General Ledger filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
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
            columns={[
              { title: "Date", dataIndex: "entryDate" },
              {
                title: "Entry",
                dataIndex: "entryNumber",
                render: (n, r) => {
                  const href = sourceHref(r.sourceType, r.sourceId);
                  return href ? <Link href={href}>{n}</Link> : n;
                },
              },
              { title: "Source", dataIndex: "sourceType" },
              { title: "Memo", dataIndex: "memo" },
              { title: "Debit", align: "right", render: (_, r) => (r.debitMinor ? fmt(r.debitMinor) : "") },
              { title: "Credit", align: "right", render: (_, r) => (r.creditMinor ? fmt(r.creditMinor) : "") },
              { title: "Running", align: "right", render: (_, r) => fmt(r.runningMinor) },
            ]}
          />
        </>
      )}
    </Space>
  );
}
