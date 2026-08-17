"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Input, Select, Space, Statistic, Tooltip, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import {
  filterGeneralLedgerRows,
  parseAmountFilterInput,
  type AmountFilter,
} from "@/lib/domain/transaction-filter";
import { generalLedgerAction } from "./actions";
import type { GeneralLedger, GeneralLedgerRow } from "@/lib/services/journal";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const GENERAL_LEDGER_DEFAULT_PAGE_SIZE = 50;

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
  // RQ-02: keyword (Entry number, Memo, Source) and amount, applied to the
  // full set of posted lines the server already returned for this account and
  // date range — not just whichever page the table is currently showing.
  const [keyword, setKeyword] = useState("");
  const [exactAmountText, setExactAmountText] = useState("");
  const [minAmountText, setMinAmountText] = useState("");
  const [maxAmountText, setMaxAmountText] = useState("");
  const [pageSize, setPageSize] = useState<number>(GENERAL_LEDGER_DEFAULT_PAGE_SIZE);

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

  // The report itself is always in base currency (see getGeneralLedger), so
  // baseDecimals is the correct — and only — decimal count to parse an
  // amount box against; there is no per-row currency ambiguity here the way
  // there can be on the all-accounts Bank Transactions queue.
  const amountFilter: AmountFilter = {
    exactMinor: parseAmountFilterInput(exactAmountText, baseDecimals),
    minMinor: parseAmountFilterInput(minAmountText, baseDecimals),
    maxMinor: parseAmountFilterInput(maxAmountText, baseDecimals),
  };
  const hasKeywordOrAmountFilter =
    keyword.trim() !== "" || exactAmountText.trim() !== "" || minAmountText.trim() !== "" || maxAmountText.trim() !== "";
  // Filtering the already-fetched rows, not the page the table currently
  // shows: `gl.rows` is every posted line the server matched for this account
  // and date range (DataTable pages it at 50/page in the browser), so this
  // narrows the real result set the same way the account/date filters do.
  const visibleRows = gl ? filterGeneralLedgerRows(gl.rows, keyword, amountFilter) : [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={gl ? visibleRows.length : undefined}
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
        <Input.Search
          allowClear
          aria-label="Search the General Ledger by entry number, memo, or source"
          placeholder="Search entry number, memo, or source"
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Input
          allowClear
          aria-label="Filter the General Ledger by exact amount"
          placeholder="Exact amount"
          style={{ width: 130 }}
          value={exactAmountText}
          onChange={(event) => setExactAmountText(event.target.value)}
        />
        <Input
          allowClear
          aria-label="Filter the General Ledger by minimum amount"
          placeholder="Min amount"
          style={{ width: 120 }}
          value={minAmountText}
          onChange={(event) => setMinAmountText(event.target.value)}
        />
        <Input
          allowClear
          aria-label="Filter the General Ledger by maximum amount"
          placeholder="Max amount"
          style={{ width: 120 }}
          value={maxAmountText}
          onChange={(event) => setMaxAmountText(event.target.value)}
        />
        {hasKeywordOrAmountFilter ? (
          <Button
            onClick={() => {
              setKeyword("");
              setExactAmountText("");
              setMinAmountText("");
              setMaxAmountText("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
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
            dataSource={visibleRows}
            // A ledger runs to thousands of lines on a real bank account, and
            // rendering them all at once is what made this page slow to open
            // and impossible to find anything in. Fifty to a page, with the
            // size changer for anybody who wants the whole run.
            //
            // Paging is safe here because the running balance is worked out
            // over the entire range on the server, not across the rows on
            // screen — page 4 carries on from page 3 rather than restarting.
            // Filtering above does not touch runningMinor on the rows that
            // remain, so a filtered view still shows each line's real,
            // whole-range running balance rather than one recomputed over
            // just the visible subset.
            //
            // "the size changer for anybody who wants the whole run" above
            // did not actually hold: a literal `{ pageSize: 50 }` here pinned
            // the table back to 50 the instant anything re-rendered it, no
            // matter what the size changer reported (RQ-04's bug, found again
            // on this screen). See table-pagination.ts for the mechanism.
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(GENERAL_LEDGER_DEFAULT_PAGE_SIZE))}
            loading={loading}
            emptyTitle={hasKeywordOrAmountFilter ? "Nothing matches these filters" : "No ledger activity"}
            emptyDescription={
              hasKeywordOrAmountFilter
                ? "Clear a filter, or widen the search."
                : "No posted entries were found for this account and date range."
            }
            // The table is held to the width of the page rather than the width
            // of its contents. `DataTable` asks for `x: "max-content"` by
            // default, which suits a table whose columns all need their room —
            // but here a bank memo carries the entire wire description, several
            // hundred characters of it, so max-content meant the memo decided
            // how wide the table was and pushed Debit, Credit and Running off
            // the side of the screen. Zooming out did not help, because the
            // memo took the extra room too.
            //
            // Widths and `ellipsis` alone did not fix this: with max-content
            // still asked for, a column left to size itself is free to grow,
            // whatever the other columns are pinned to. Giving up the
            // horizontal scroll is what makes the widths bind.
            //
            // `ellipsis` cuts the memo to its column and keeps the whole text in
            // the cell's title, so it is still readable on hover.
            scroll={{ x: undefined }}
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
              {
                title: "Memo",
                dataIndex: "memo",
                // `showTitle: false` turns off the browser's own tooltip, which
                // is slow to appear and renders a wire description as one
                // unbroken line. The Ant Design one replaces it: it opens at
                // once and wraps, which is the only way several hundred
                // characters are readable.
                ellipsis: { showTitle: false },
                render: (memo: string | null) =>
                  memo ? (
                    <Tooltip title={memo} placement="topLeft" styles={{ root: { maxWidth: 640 } }}>
                      <span>{memo}</span>
                    </Tooltip>
                  ) : (
                    ""
                  ),
              },
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
