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
import { ColumnHeaderCell } from "@/components/ui/ColumnHeaderCell";
import { useColumnResize } from "@/components/ui/useColumnResize";
import { totalColumnWidth } from "@/lib/domain/column-width";
import {
  GENERAL_LEDGER_DEFAULT_WIDTHS,
  GENERAL_LEDGER_WIDTH_STORAGE_KEY,
  type GeneralLedgerColumnKey,
} from "./general-ledger-columns";

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

  // REQ-01: this reader's own column widths, kept between visits. Memo is the
  // one they asked for — a wire description ran to several hundred characters
  // in a column that had no width of its own, so it got whatever room was
  // left after the six fixed ones.
  const { widths, resizeHandleProps } = useColumnResize<GeneralLedgerColumnKey>(
    GENERAL_LEDGER_DEFAULT_WIDTHS,
    GENERAL_LEDGER_WIDTH_STORAGE_KEY,
  );

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
            // Every heading here carries a resize handle (REQ-01, the second
            // reference video). Columns that are not given one — this table
            // has none today — simply render as Ant Design's own header cell.
            components={{ header: { cell: ColumnHeaderCell } }}
            // Named rather than inherited. This table lands in `fixed` layout
            // today only because Memo happens to carry `ellipsis`, which
            // rc-table reads as a signal; remove that one property and every
            // width below silently stops binding.
            tableLayout="fixed"
            // The previous fix for this screen was `scroll={{ x: undefined }}`:
            // a wire memo several hundred characters long decided how wide the
            // table was and pushed Debit, Credit and Running off the side, and
            // giving up the horizontal scroll is what made the widths bind.
            //
            // That cannot stay once the reader controls the widths. REQ-01
            // requires horizontal scrolling to keep working when the total
            // exceeds the viewport, and a table pinned to the page cannot let
            // anyone widen Memo without crushing Debit and Credit to do it.
            // The memo can no longer run away on its own — it has a width like
            // everything else — so the scroll is now the reader's choice
            // rather than the longest description's.
            scroll={{ x: totalColumnWidth(widths, 0) }}
            // Holds the table to exactly the widths above. Without it, a table
            // narrower than the page is stretched to fill it and the spare
            // room is shared out across every column — so narrowing Memo would
            // widen Debit, Credit and Running, which REQ-01 forbids and no
            // spreadsheet does. See app/globals.css.
            className="accounting-table--exact-widths"
            columns={[
              {
                title: "Date",
                dataIndex: "entryDate",
                width: widths.date,
                onHeaderCell: () => resizeHandleProps("date"),
              },
              {
                title: "Entry",
                dataIndex: "entryNumber",
                width: widths.entry,
                onHeaderCell: () => resizeHandleProps("entry"),
                render: (number, row) => (
                  <Link href={`/reports/journal?entry=${row.entryId}`}>{number}</Link>
                ),
              },
              {
                title: "Source",
                dataIndex: "sourceType",
                width: widths.source,
                onHeaderCell: () => resizeHandleProps("source"),
                render: (source, row) => {
                  const href = sourceHref(row.sourceType, row.sourceId);
                  return href ? <Link href={href}>{source}</Link> : source;
                },
              },
              {
                // DESCRIPTION in the video, and the column they were dragging.
                title: "Memo",
                dataIndex: "memo",
                width: widths.memo,
                onHeaderCell: () => resizeHandleProps("memo"),
                // `showTitle: false` turns off the browser's own tooltip, which
                // is slow to appear and renders a wire description as one
                // unbroken line. The Ant Design one replaces it: it opens at
                // once and wraps, which is the only way several hundred
                // characters are readable — and it is what keeps narrowing
                // this column safe, because nothing is ever put out of reach.
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
                width: widths.debit,
                onHeaderCell: () => resizeHandleProps("debit"),
                render: (_, r) => (r.debitMinor ? fmt(r.debitMinor) : ""),
              },
              {
                title: "Credit",
                align: "right",
                width: widths.credit,
                onHeaderCell: () => resizeHandleProps("credit"),
                render: (_, r) => (r.creditMinor ? fmt(r.creditMinor) : ""),
              },
              {
                title: "Running",
                align: "right",
                width: widths.running,
                onHeaderCell: () => resizeHandleProps("running"),
                render: (_, r) => fmt(r.runningMinor),
              },
            ]}
          />
        </>
      )}
    </Space>
  );
}
