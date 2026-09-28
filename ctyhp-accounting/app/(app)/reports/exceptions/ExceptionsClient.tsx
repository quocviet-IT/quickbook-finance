"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Select, Space, Spin, Tag, type TableColumnsType } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import {
  ReportFoot,
  ReportPaper,
  ReportSection,
  SourceTag,
  StatRow,
  reportPaperStyles as styles,
  type SectionState,
} from "@/components/reports/ReportPaper";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { downloadTextFile } from "@/lib/client/download";
import { ACCOUNT_TYPE_LABEL } from "@/lib/domain/accounts";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, presetRange, rangeText, shortDate, type PeriodPreset } from "@/lib/domain/report-presets";
import {
  CHECK_LABEL,
  exceptionReportSheet,
  type CheckKey,
  type ExceptionPaymentRef,
  type ExceptionReport,
  type HoldingRow,
  type IncomeNoCostRow,
  type TransactionListRow,
  type UndepositedRow,
  type UnreconciledRow,
  type WrongWayRow,
} from "@/lib/domain/exceptions";
import { exceptionReportAction } from "./actions";

/** A row of an entry table, with where it sits in its group of look-alikes. */
interface EntryTableRow {
  key: string;
  row: TransactionListRow;
  /** The size of its group, on the group's first row only. */
  times: number | null;
  groupStart: boolean;
}

interface ClashTableRow {
  key: string;
  payment: ExceptionPaymentRef;
  /** The account and number, on the first row of each clash only. */
  account: string | null;
  number: string | null;
  groupStart: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The Exception Report, laid out as the client's prototype lays it out
 * (`reportExceptions` in Accounting-System-v3.html): a period picker, the
 * report on paper under its heading, three figures, then the eight checks —
 * each with its question, why it matters, and what it found. Every section is
 * drawn, including the ones with nothing in them, because a reviewer has to see
 * that a check ran. Clicking a line opens the entry behind it in a side sheet.
 *
 * Nothing on this screen writes.
 */
export default function ExceptionsClient({
  companyName,
  baseCurrency,
  baseDecimals,
  fiscalStartMonth,
  today,
  firstEntryDate,
  lastEntryDate,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  fiscalStartMonth: number;
  today: string;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
}) {
  const ctx = useMemo(
    () => ({ today, fiscalStartMonth, firstEntryDate, lastEntryDate }),
    [today, fiscalStartMonth, firstEntryDate, lastEntryDate],
  );
  const initial = useMemo(() => presetRange("year", ctx), [ctx]);

  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  /** The range the report on screen was run for, which the heading states. */
  const [ran, setRan] = useState(initial);
  const [report, setReport] = useState<ExceptionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);

  const run = useCallback(async (f: string, t: string) => {
    if (f > t) {
      setError("The start date is after the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await exceptionReportAction(f, t);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The report could not be produced.");
      return;
    }
    setReport(result.data);
    setRan({ from: f, to: t });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(initial.from, initial.to);
    // Run once on arrival; afterwards a period choice or the Run button runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom") return;
    const range = presetRange(key, ctx);
    setFrom(range.from);
    setTo(range.to);
    void run(range.from, range.to);
  };

  const sheet = useMemo(
    () =>
      report
        ? exceptionReportSheet(report, {
            companyName,
            currencyCode: baseCurrency,
            decimals: baseDecimals,
            from: ran.from,
            to: ran.to,
          })
        : null,
    [report, companyName, baseCurrency, baseDecimals, ran],
  );

  const accountLink = (accountId: string, label: string) => (
    <a
      className={styles.accountLink}
      href={`/reports/general-ledger?account=${accountId}&to=${ran.to}`}
      target="_blank"
      rel="noopener"
      title="Open this account's ledger in a new tab"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );

  /* ---------------------------------------------------------- tables */

  const entryColumns = (withTimes: boolean): TableColumnsType<EntryTableRow> => [
    { title: "Date", key: "date", width: 108, render: (_, r) => shortDate(r.row.entryDate) },
    {
      title: "Type",
      key: "type",
      width: 180,
      render: (_, r) => <SourceTag sourceType={r.row.sourceType} number={r.row.entryNumber} />,
    },
    flexColumn<EntryTableRow>({
      title: "Name",
      key: "name",
      render: (_, r) => {
        const name = entryDisplayName(r.row);
        return <span title={name}>{name || "—"}</span>;
      },
    }),
    flexColumn<EntryTableRow>({
      title: "Split",
      key: "split",
      render: (_, r) => (
        <span className={styles.muted} title={r.row.categoryLabel ?? ""}>
          {r.row.categoryLabel ?? "—"}
        </span>
      ),
    }),
    {
      title: "Amount",
      key: "amount",
      width: COLUMN.MONEY_WIDE,
      align: "right",
      render: (_, r) => money(r.row.amountMinor),
    },
    ...(withTimes
      ? [
          {
            title: "Times",
            key: "times",
            width: 76,
            align: "center" as const,
            render: (_: unknown, r: EntryTableRow) => (r.times ? <Tag color="orange">{r.times}</Tag> : null),
          },
        ]
      : []),
  ];

  const entryTable = (rows: EntryTableRow[], withTimes: boolean) => (
    <DataTable<EntryTableRow>
      rowKey="key"
      pagination={false}
      dataSource={rows}
      columns={entryColumns(withTimes)}
      rowClassName={(r) => `${styles.clickable}${r.groupStart ? ` ${styles.groupStart}` : ""}`}
      onRow={(r) => ({ onClick: () => setOpenEntry(r.row.entryId), title: "Open this entry" })}
    />
  );

  /* ---------------------------------------------------------- sections */

  const state = (check: CheckKey, count: number): SectionState =>
    report?.unavailable.includes(check) ? { kind: "unavailable" } : count > 0 ? { kind: "found", count } : { kind: "clear" };

  const body = (r: ExceptionReport): ReactNode => {
    const duplicateRows: EntryTableRow[] = r.duplicates.flatMap((g, gi) =>
      g.entries.map((row, i) => ({
        key: `${g.key}:${row.entryId}`,
        row,
        times: i === 0 ? g.entries.length : null,
        groupStart: i === 0 && gi > 0,
      })),
    );
    const clashRows: ClashTableRow[] = r.checkNumberClashes.flatMap((c, ci) =>
      c.payments.map((payment, i) => ({
        key: `${c.accountId}:${c.reference}:${payment.paymentId}`,
        payment,
        account: i === 0 ? c.accountName : null,
        number: i === 0 ? c.reference : null,
        groupStart: i === 0 && ci > 0,
      })),
    );
    const futureRows: EntryTableRow[] = r.futureDated.map((row) => ({
      key: row.entryId,
      row,
      times: null,
      groupStart: false,
    }));

    return (
      <>
        <ReportSection
          title={CHECK_LABEL.duplicates}
          note={plural(r.duplicates.length, "group", "groups")}
          state={state("duplicates", r.duplicates.length)}
          why="Same date, same name, same reference, same accounts, same amount. Repeated wages on one day are normal when several people are paid the same; the same supplier paid twice usually is not."
        >
          {entryTable(duplicateRows, true)}
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.checkNumber}
          note={plural(r.checkNumberClashes.length, "number", "numbers")}
          state={state("checkNumber", r.checkNumberClashes.length)}
          why="Counted per bank account, so the same number in two different check books is not flagged. Two entries against one number on one account means one of them is miscoded, or the check was reissued."
        >
          <DataTable<ClashTableRow>
            rowKey="key"
            pagination={false}
            dataSource={clashRows}
            rowClassName={(row) =>
              `${row.payment.journalEntryId ? styles.clickable : ""}${row.groupStart ? ` ${styles.groupStart}` : ""}`
            }
            onRow={(row) => ({
              onClick: () => row.payment.journalEntryId && setOpenEntry(row.payment.journalEntryId),
            })}
            columns={[
              flexColumn<ClashTableRow>({ title: "Account", key: "account", render: (_, row) => row.account ?? "" }),
              {
                title: "Number",
                key: "number",
                width: COLUMN.CODE,
                render: (_, row) => <span className={styles.mono}>{row.number ?? ""}</span>,
              },
              { title: "Date", key: "date", width: 108, render: (_, row) => shortDate(row.payment.paymentDate) },
              flexColumn<ClashTableRow>({
                title: "Name",
                key: "name",
                render: (_, row) => row.payment.partyName || "—",
              }),
              {
                title: "Amount",
                key: "amount",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => money(row.payment.amountMinor),
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.undeposited}
          note={plural(r.undeposited.length, "account", "accounts")}
          state={state("undeposited", r.undeposited.length)}
          why="Undeposited funds should empty as takings reach the bank. A balance that keeps growing means the sales are recorded but the deposits are not — revenue is in the books, the cash is not."
        >
          <DataTable<UndepositedRow>
            rowKey="accountId"
            pagination={false}
            dataSource={r.undeposited}
            columns={[
              flexColumn<UndepositedRow>({
                title: "Account",
                key: "account",
                render: (_, row) => accountLink(row.accountId, `${row.accountCode} — ${row.name}`),
              }),
              { title: "Balance", key: "balance", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.balanceMinor) },
              { title: "Entries", key: "entries", width: COLUMN.QTY, align: "right", render: (_, row) => row.entryCount ?? "—" },
              {
                title: "Oldest",
                key: "oldest",
                width: 108,
                render: (_, row) => (row.oldestEntryDate ? shortDate(row.oldestEntryDate) : "—"),
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.wrongWay}
          note={`${plural(r.wrongWay.length, "account", "accounts")} · as of ${shortDate(ran.to)}`}
          state={state("wrongWay", r.wrongWay.length)}
          why="An asset in credit or a liability in debit. Sometimes right — an overdrawn account, a supplier overpaid — and sometimes a posting on the wrong side. Contra accounts are left out of this check."
        >
          <DataTable<WrongWayRow>
            rowKey="accountId"
            pagination={false}
            dataSource={r.wrongWay}
            columns={[
              flexColumn<WrongWayRow>({
                title: "Account",
                key: "account",
                render: (_, row) => accountLink(row.accountId, `${row.accountCode} — ${row.name}`),
              }),
              { title: "Type", key: "type", width: 170, render: (_, row) => <Tag>{ACCOUNT_TYPE_LABEL[row.accountType]}</Tag> },
              {
                title: `Balance as of ${shortDate(ran.to)}`,
                key: "balance",
                width: 220,
                align: "right",
                render: (_, row) => <span className={styles.negative}>{money(row.balanceMinor)}</span>,
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.incomeNoCost}
          note={`${plural(r.incomeNoCost.length, "year", "years")} · looks at every year in the books`}
          state={state("incomeNoCost", r.incomeNoCost.length)}
          why="Revenue with nothing spent against it almost always means the period is only part-entered. The profit shown for that year is not a profit."
        >
          <DataTable<IncomeNoCostRow>
            rowKey="year"
            pagination={false}
            dataSource={r.incomeNoCost}
            columns={[
              flexColumn<IncomeNoCostRow>({ title: "Year", key: "year", render: (_, row) => row.year }),
              { title: "Income", key: "income", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.incomeMinor) },
              {
                title: "Expenses",
                key: "expenses",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => <span className={styles.negative}>{money(row.costMinor)}</span>,
              },
              { title: "Entries", key: "entries", width: COLUMN.QTY, align: "right", render: (_, row) => row.entryCount ?? "—" },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.unreconciled}
          note={plural(r.unreconciled.length, "account", "accounts")}
          state={state("unreconciled", r.unreconciled.length)}
          why={
            <>
              A balance nobody has proved against the bank. Reconcile it on the{" "}
              <Link href="/banking/reconcile">Reconcile</Link> screen.
            </>
          }
        >
          <DataTable<UnreconciledRow>
            rowKey="bankAccountId"
            pagination={false}
            dataSource={r.unreconciled}
            columns={[
              flexColumn<UnreconciledRow>({
                title: "Account",
                key: "account",
                render: (_, row) => accountLink(row.accountId, row.accountName),
              }),
              { title: "Balance", key: "balance", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.balanceMinor) },
              {
                title: "Last reconciled",
                key: "last",
                width: 140,
                render: (_, row) =>
                  row.lastReconciledDate ? shortDate(row.lastReconciledDate) : <Tag color="orange">never</Tag>,
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.futureDated}
          note={`${plural(r.futureDated.length, "entry", "entries")} · dated after ${shortDate(today)}`}
          state={state("futureDated", r.futureDated.length)}
          why="Dated after today. Usually a typing slip in the year."
        >
          {entryTable(futureRows, false)}
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.holding}
          note={plural(r.holding.length, "account", "accounts")}
          state={state("holding", r.holding.length)}
          why="Anything left in Uncategorized has not been given an account yet, so it is in the wrong place on both statements."
        >
          <DataTable<HoldingRow>
            rowKey="accountId"
            pagination={false}
            dataSource={r.holding}
            columns={[
              flexColumn<HoldingRow>({
                title: "Account",
                key: "account",
                render: (_, row) => accountLink(row.accountId, `${row.accountCode} — ${row.name}`),
              }),
              {
                title: "Balance",
                key: "balance",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => <span className={styles.negative}>{money(row.balanceMinor)}</span>,
              },
            ]}
          />
        </ReportSection>
      </>
    );
  };

  /* ---------------------------------------------------------- page */

  const paper = (
    <ReportPaper companyName={companyName} title="Exception Report" range={rangeText(ran.from, ran.to)} currencyCode={baseCurrency}>
      {report ? (
        <>
          <StatRow
            items={[
              { label: "Entries examined", value: report.entriesExamined.toLocaleString("en-US") },
              { label: "Questions raised", value: report.questionsRaised, danger: report.questionsRaised > 0 },
              {
                label: "Checks run",
                value: report.unavailable.length > 0 ? `${8 - report.unavailable.length} of 8` : 8,
              },
            ]}
          />
          {report.unavailable.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 20 }}
              title={`${report.unavailable.length} of 8 checks could not be run`}
              description={`${report.unavailable.map((c) => CHECK_LABEL[c]).join("; ")}. The rest of the report is complete. A check that could not run is not saying the books are clear — run the report again.`}
            />
          ) : null}
          {body(report)}
          <ReportFoot>
            <strong>Nothing here is proof of a mistake.</strong> Each line is a question a reviewer would ask, and
            most have an innocent answer — four wages of the same amount on one day, a check book that restarts at
            1000. What matters is that somebody has looked and can say why. Click any line to open the entry behind
            it.
          </ReportFoot>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          {loading ? (
            <Space orientation="vertical" size={12}>
              <Spin size="large" />
              <span className={styles.muted}>Running eight checks over the books…</span>
            </Space>
          ) : (
            <span className={styles.muted}>The report has not been run.</span>
          )}
        </div>
      )}
    </ReportPaper>
  );

  return (
    <div>
      <FilterBar
        ariaLabel="Report period and exports"
        actions={
          <Space wrap>
            {sheet ? <ReportExportButtons sheet={sheet} disabled={loading} /> : null}
            <Button
              disabled={!sheet || loading}
              onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}
            >
              CSV
            </Button>
          </Space>
        }
      >
        <Select<PeriodPreset>
          aria-label="Period"
          value={preset}
          onChange={choosePreset}
          options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          style={{ width: 150 }}
        />
        <DatePicker
          aria-label="From"
          prefix={<span className={styles.muted}>From</span>}
          value={dayjs(from)}
          allowClear={false}
          onChange={(d) => {
            if (!d) return;
            setFrom(d.format("YYYY-MM-DD"));
            setPreset("custom");
          }}
        />
        <DatePicker
          aria-label="To"
          prefix={<span className={styles.muted}>To</span>}
          value={dayjs(to)}
          allowClear={false}
          onChange={(d) => {
            if (!d) return;
            setTo(d.format("YYYY-MM-DD"));
            setPreset("custom");
          }}
        />
        <Button type="primary" onClick={() => void run(from, to)} loading={loading}>
          Run
        </Button>
      </FilterBar>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}

      {report && loading ? <Spin spinning description="Running the checks again…">{paper}</Spin> : paper}

      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
