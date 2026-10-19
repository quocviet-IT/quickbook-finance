"use client";
import { sourceLabel } from "@/lib/domain/entry-detail";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Alert, Button, Input, Select, Space, Spin, Tooltip } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportBar, { ReportPrompt, type ReportDates } from "@/components/reports/ReportBar";
import { ReportPaper, StatRow, reportPaperStyles as paperStyles } from "@/components/reports/ReportPaper";
import { reportPagination } from "@/components/reports/SimpleReport";
import { watchReportPrinting } from "@/lib/client/print-report";
import { formatDate, formatDateRange, formatMoney } from "@/lib/format";
import { sourceHref as documentHref } from "@/lib/domain/entry-detail";
import { generalLedgerSheet } from "@/lib/domain/ledger-report-sheets";
import { presetRange, type PeriodPreset, type PresetContext } from "@/lib/domain/report-presets";
import {
  filterGeneralLedgerRows,
  parseAmountFilterInput,
  type AmountFilter,
} from "@/lib/domain/transaction-filter";
import { generalLedgerAction } from "./actions";
import type { GeneralLedger, GeneralLedgerRow } from "@/lib/services/journal";
import { ColumnHeaderCell } from "@/components/ui/ColumnHeaderCell";
import { useColumnResize } from "@/components/ui/useColumnResize";
import {
  GENERAL_LEDGER_BUDGET,
  GENERAL_LEDGER_DEFAULT_WIDTHS,
  GENERAL_LEDGER_WIDTH_STORAGE_KEY,
  GENERAL_LEDGER_WIDTH_STORAGE_KEY_V1,
  type GeneralLedgerColumnKey,
} from "./general-ledger-columns";
import { secondaryLine } from "@/components/ui/columns";

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
  companyName: string;
  presets: PresetContext;
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
  // A stock count has a page of its own, opened by id rather than filtered by ?source=.
  const own = documentHref(sourceType, sourceId);
  if (own) return own;
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
  companyName,
  presets,
  baseCurrency,
  baseDecimals,
  initialAccountId,
  initialFrom,
  initialTo,
}: Props) {
  const validInitialAccount = accounts.some((account) => account.id === initialAccountId)
    ? initialAccountId
    : undefined;
  const [accountId, setAccountId] = useState<string | undefined>(validInitialAccount);
  // A deep link (?account=&to=) opens on its own range; otherwise this year.
  const [preset, setPreset] = useState<PeriodPreset>(initialTo ? "custom" : "year");
  const [draft, setDraft] = useState<{ from: string; to: string }>(() =>
    initialTo ? { from: initialFrom ?? "2000-01-01", to: initialTo } : presetRange("year", presets),
  );
  const [ran, setRan] = useState(draft);
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(Boolean(validInitialAccount));
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  /** Counts runs, so only the newest one's answer is shown. */
  const latestRun = useRef(0);
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
    {},
    GENERAL_LEDGER_BUDGET,
    GENERAL_LEDGER_WIDTH_STORAGE_KEY_V1,
  );

  const run = async (account: string, when: { from: string; to: string }) => {
    if (when.from > when.to) {
      setError("The start date is after the end date.");
      return;
    }
    const thisRun = ++latestRun.current;
    const overtaken = () => thisRun !== latestRun.current;
    setLoading(true);
    setError(null);
    try {
      const r = await generalLedgerAction(account, when.from, when.to);
      if (overtaken()) return;
      if (r.ok && r.data) {
        setGl(r.data);
        setRan(when);
      } else {
        setError(r.error ?? "The report could not be produced.");
      }
    } catch {
      if (overtaken()) return;
      setError("The report could not be produced. Check the connection and run it again.");
    } finally {
      if (!overtaken()) setLoading(false);
    }
  };

  useEffect(() => {
    // Opens already run: on the deep-linked account, or once one is chosen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (validInitialAccount) void run(validInitialAccount, draft);
    // Only on arrival; afterwards a choice, a period or Run report runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stop = watchReportPrinting();
    // Synchronous on purpose: the browser takes its print snapshot right after
    // `beforeprint`, so every row must be in the page by the time it returns.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      stop();
    };
  }, []);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom") return;
    const next = presetRange(key, presets);
    setDraft(next);
    if (accountId) void run(accountId, next);
  };
  const dates: ReportDates = {
    kind: "range",
    preset,
    from: draft.from,
    to: draft.to,
    onPreset: choosePreset,
    onFrom: (from) => {
      setDraft({ ...draft, from });
      setPreset("custom");
    },
    onTo: (to) => {
      setDraft({ ...draft, to });
      setPreset("custom");
    },
  };
  const fmt = (m: number) => formatMoney(m, baseCurrency, baseDecimals);

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
  const { exactMinor, minMinor, maxMinor } = amountFilter;
  const visibleRows = useMemo(
    () => (gl ? filterGeneralLedgerRows(gl.rows, keyword, { exactMinor, minMinor, maxMinor }) : []),
    [gl, keyword, exactMinor, minMinor, maxMinor],
  );
  const sheet = useMemo(
    () => (gl ? generalLedgerSheet(gl, visibleRows, ran, { companyName, currencyCode: baseCurrency, baseDecimals }) : null),
    [gl, visibleRows, ran, companyName, baseCurrency, baseDecimals],
  );

  // These narrow what is shown of the rows already run, not the query, so they
  // sit on the report and not in the bar. They are left off the printed page.
  const viewFilters = (
    <div style={{ marginBottom: 12 }}>
      <Space wrap>
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
      </Space>
    </div>
  );

  const accountPicker = (
    <Select
      showSearch
      style={{ width: 280 }}
      placeholder="Account"
      aria-label="Account"
      optionFilterProp="label"
      value={accountId}
      options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
      onChange={(id) => {
        setAccountId(id);
        void run(id, draft);
      }}
    />
  );

  const body = gl ? (
        <>
          <StatRow
            items={[
              { label: "Account", value: `${gl.accountCode} ${gl.accountName}` },
              { label: "Opening", value: fmt(gl.openingMinor) },
              { label: "Closing", value: fmt(gl.closingMinor) },
            ]}
          />
          {printing ? null : viewFilters}
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
            pagination={reportPagination(printing, pageSize, setPageSize, GENERAL_LEDGER_DEFAULT_PAGE_SIZE)}
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
            // No `scroll.x`. The memo carries no width and absorbs the
            // remainder, so the row total IS the box — handing rc-table a
            // total was what let a widened column produce the sideways
            // scrolling this report was reported for twice.
            // Holds the table to exactly the widths above. Without it, a table
            // narrower than the page is stretched to fill it and the spare
            // room is shared out across every column — so narrowing Memo would
            // widen Debit, Credit and Running, which REQ-01 forbids and no
            // spreadsheet does. See app/globals.css.

            columns={[
              {
                title: "Date",
                dataIndex: "entryDate",
                width: widths.date,
                render: (v: string) => formatDate(v),
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
                // DESCRIPTION in the video, and the column they were dragging.
                // Elastic now: it takes whatever the measured columns leave,
                // so it is widest exactly where there is room for it to be.
                // Source used to be a column of its own and reads underneath.
                title: "Memo",
                dataIndex: "memo",
                ellipsis: { showTitle: false },
                render: (memo: string | null, row) => {
                  const href = sourceHref(row.sourceType, row.sourceId);
                  return (
                    <div style={{ minWidth: 0 }}>
                      {/* `showTitle: false` above turns off the browser's own
                          tooltip, which is slow and renders a wire description
                          as one unbroken line. The Ant Design one opens at once
                          and wraps, which is what keeps a narrowed column safe:
                          nothing is ever put out of reach. */}
                      <Tooltip title={memo} placement="topLeft" styles={{ root: { maxWidth: 640 } }}>
                        <span>{memo ?? ""}</span>
                      </Tooltip>
                      {secondaryLine(
                        href ? <Link href={href}>{sourceLabel(row.sourceType)}</Link> : sourceLabel(row.sourceType),
                      )}
                    </div>
                  );
                },
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
  ) : null;

  const paper = (
    <div className="report-print-area">
      <ReportPaper companyName={companyName} title="General Ledger" range={formatDateRange(ran.from, ran.to)} currencyCode={baseCurrency}>
        {body ??
          (accountId ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              {loading ? (
                <Space orientation="vertical" size={12}>
                  <Spin size="large" />
                  <span className={paperStyles.muted}>Reading the ledger…</span>
                </Space>
              ) : (
                <span className={paperStyles.muted}>The report has not been run.</span>
              )}
            </div>
          ) : (
            <ReportPrompt
              title="Choose an account"
              description="Pick the account whose activity you want. It opens for this year; change the dates and Run report for another period."
            />
          ))}
      </ReportPaper>
    </div>
  );

  return (
    <div>
      <ReportBar
        dates={dates}
        resultCount={gl ? visibleRows.length : undefined}
        ariaLabel="General Ledger filters"
        onRun={() => accountId && void run(accountId, draft)}
        loading={loading}
        runDisabled={!accountId}
        sheet={sheet}
        filters={accountPicker}
      />
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {gl && loading ? (
        <Spin spinning description="Running the report again…">
          {paper}
        </Spin>
      ) : (
        paper
      )}
    </div>
  );
}
