"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Select, Space, Spin, Tag, type TableColumnsType } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, type FlexColumnSpec } from "@/components/ui/columns";
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
  clearingSentences,
  exceptionReportSheet,
  type CheckKey,
  type ClearingRow,
  type ExceptionPaymentRef,
  type ExceptionReport,
  type HoldingRow,
  type IncomeNoCostRow,
  type NoLongerAgreeRow,
  type StatementOverrideRow,
  type TransferOneSideRow,
  type TransactionListRow,
  type UnreconciledRow,
  type WrongWayRow,
} from "@/lib/domain/exceptions";
import { reconcileHref, type BelowZeroRow, type StatementBalanceRow } from "@/lib/domain/statement-alerts";
import { CLEARING_WHY, CLEARING_FIFO_NOTE, LEFT_STANDING } from "@/lib/domain/clearing-accounts";
import { ToneBadge } from "@/lib/design/tone";
import { reconciliationChangeSentences } from "@/lib/domain/reconciliation-changes";
import { candidateNote, correctedSentence, destinationSentence, transferNote } from "@/lib/domain/transfer-legs";
import { CLEARING_TAG_WIDTH } from "./clearing-columns";
import {
  CHANGED_ACCOUNT_FLOOR,
  CHANGED_SENTENCES_FLOOR,
  CHANGED_STATEMENT_WIDTH,
  TRANSFER_CLEARED_FLOOR,
  TRANSFER_DESTINATION_FLOOR,
  TRANSFER_ENTRY_WIDTH,
  TRANSFER_OPEN_FLOOR,
} from "./integrity-columns";
import {
  OVERRIDE_ACCOUNT_FLOOR,
  OVERRIDE_BY_FLOOR,
  OVERRIDE_FILE_FLOOR,
  OVERRIDE_IMPORTED_WIDTH,
  OVERRIDE_REASON_FLOOR,
  OVERRIDE_SINCE_WIDTH,
} from "./override-columns";
import clearingStyles from "./clearing-table.module.css";
import overridesStyles from "./overrides-table.module.css";
import integrityStyles from "./integrity-tables.module.css";
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
 * An elastic column that holds a sentence and wraps it, rather than cutting it.
 * An elastic column cuts with an ellipsis, and on a phone every DataTable cell
 * is kept to one line (globals.css); a style on the cell itself outranks both,
 * so "oldest Nov 19, 2025" is never the part that goes missing.
 */
function sentenceColumn<T>(spec: FlexColumnSpec<T>) {
  return { ...flexColumn<T>(spec), ellipsis: false, onCell: () => ({ style: { whiteSpace: "normal" as const } }) };
}

/**
 * The Exception Report, laid out as the client's prototype lays it out
 * (`reportExceptions` in Accounting-System-v3.html): a period picker, the
 * report on paper under its heading, three figures, then the thirteen checks —
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
          title={CHECK_LABEL.clearing}
          note={plural(r.clearing.length, "account", "accounts")}
          state={state("clearing", r.clearing.length)}
          why={`${CLEARING_WHY} ${CLEARING_FIFO_NOTE}`}
        >
          <div className={clearingStyles.clearingTable}>
          <DataTable<ClearingRow>
            rowKey="accountId"
            pagination={false}
            dataSource={r.clearing}
            columns={[
              flexColumn<ClearingRow>({
                title: "Account",
                key: "account",
                render: (_, row) => accountLink(row.accountId, `${row.accountCode} — ${row.name}`),
              }),
              { title: "Balance", key: "balance", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.balanceMinor) },
              sentenceColumn<ClearingRow>({
                title: "Open items",
                key: "items",
                render: (_, row) => clearingSentences(row, ran.to, money).composition ?? "—",
              }),
              sentenceColumn<ClearingRow>({
                title: "Last movement",
                key: "movement",
                render: (_, row) => clearingSentences(row, ran.to, money).idle ?? "—",
              }),
              {
                title: "",
                key: "standing",
                width: CLEARING_TAG_WIDTH,
                render: (_, row) => (row.leftStanding ? <ToneBadge tone="warning">{LEFT_STANDING}</ToneBadge> : null),
              },
            ]}
          />
          </div>
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
              {
                title: "Since",
                key: "since",
                width: 130,
                align: "right",
                render: (_, row) =>
                  row.sinceCount === null || row.sinceNetMinor === null ? (
                    "—"
                  ) : row.sinceCount === 0 ? (
                    // As Reconcile history says it.
                    "Nothing since"
                  ) : (
                    <span>
                      {plural(row.sinceCount, "entry", "entries")}
                      <br />
                      <span className={styles.muted}>{money(row.sinceNetMinor)}</span>
                    </span>
                  ),
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.noLongerAgree}
          note={plural(r.noLongerAgree.length, "reconciliation", "reconciliations")}
          state={state("noLongerAgree", r.noLongerAgree.length)}
          why="A completed reconciliation changed after it was signed off: an entry ticked on it was voided or reversed, an entry dated inside its period was posted afterwards, or its saved total no longer adds up. Each line says what changed."
        >
          <div className={integrityStyles.changedTable}>
            <DataTable<NoLongerAgreeRow>
              rowKey="reconciliationId"
              pagination={false}
              dataSource={r.noLongerAgree}
              columns={[
                sentenceColumn<NoLongerAgreeRow>({
                  title: "Bank account",
                  key: "account",
                  floor: CHANGED_ACCOUNT_FLOOR,
                  render: (_, row) => <Link href={reconcileHref(row.bankAccountId)}>{row.accountName}</Link>,
                }),
                {
                  title: "Statement",
                  key: "statement",
                  width: CHANGED_STATEMENT_WIDTH,
                  render: (_, row) => shortDate(row.statementEndingDate),
                },
                sentenceColumn<NoLongerAgreeRow>({
                  title: "What changed",
                  key: "changes",
                  floor: CHANGED_SENTENCES_FLOOR,
                  render: (_, row) => (
                    <>
                      {reconciliationChangeSentences(row, money).map((sentence) => (
                        <div key={sentence}>{sentence}</div>
                      ))}
                    </>
                  ),
                }),
              ]}
            />
          </div>
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

        <ReportSection
          title={CHECK_LABEL.statementBalance}
          note={plural(r.statementBalance.length, "group", "groups")}
          state={state("statementBalance", r.statementBalance.length)}
          why="When a statement’s Balance column is read as amounts, a run of entries for one payee lands exactly on what the account comes to on each date. A payment does not track the balance of the account it is paid from. Open Reconcile to see the workings and remove them."
        >
          <DataTable<StatementBalanceRow>
            rowKey={(row) => `${row.bankAccountId}:${row.payee}`}
            pagination={false}
            dataSource={r.statementBalance}
            columns={[
              flexColumn<StatementBalanceRow>({ title: "Bank account", key: "account", render: (_, row) => row.accountName }),
              flexColumn<StatementBalanceRow>({
                title: "Payee",
                key: "payee",
                render: (_, row) => <span title={row.payee}>{row.payee}</span>,
              }),
              { title: "Entries", key: "entries", width: COLUMN.QTY, align: "right", render: (_, row) => row.entryCount },
              { title: "Total", key: "total", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.totalMinor) },
              {
                title: "",
                key: "open",
                width: 130,
                render: (_, row) => <Link href={reconcileHref(row.bankAccountId)}>Open Reconcile</Link>,
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.belowZero}
          note={plural(r.belowZero.length, "account", "accounts")}
          state={state("belowZero", r.belowZero.length)}
          why="Once a statement is agreed, the balance was right on that day. What drags the account under afterwards is far more often an entry that is not a payment than a real overdraft, which the bank would have printed."
        >
          <DataTable<BelowZeroRow>
            rowKey="bankAccountId"
            pagination={false}
            dataSource={r.belowZero}
            columns={[
              flexColumn<BelowZeroRow>({ title: "Bank account", key: "account", render: (_, row) => row.accountName }),
              {
                title: "Reads now",
                key: "now",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => <span className={row.nowMinor < 0 ? styles.negative : undefined}>{money(row.nowMinor)}</span>,
              },
              {
                title: "Lowest",
                key: "worst",
                width: 190,
                align: "right",
                render: (_, row) =>
                  row.worstMinor === null || row.worstDate === null ? (
                    "—"
                  ) : (
                    <span>
                      <span className={styles.negative}>{money(row.worstMinor)}</span>{" "}
                      <span className={styles.muted}>{shortDate(row.worstDate)}</span>
                    </span>
                  ),
              },
              {
                title: "Last statement",
                key: "last",
                width: 140,
                render: (_, row) =>
                  row.lastStatementDate ? shortDate(row.lastStatementDate) : <Tag color="orange">never</Tag>,
              },
              { title: "Not on a statement", key: "outstanding", width: 150, align: "right", render: (_, row) => row.outstandingCount },
              {
                title: "",
                key: "open",
                width: 130,
                render: (_, row) => <Link href={reconcileHref(row.bankAccountId)}>Open Reconcile</Link>,
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.statementOverride}
          note={plural(r.statementOverride.length, "statement", "statements")}
          state={state("statementOverride", r.statementOverride.length)}
          why="An administrator may import a statement that does not add up, with a reason. It stays here until a completed reconciliation of the same bank account reaches the date of its last line. The import record and the reconciliation it belongs to say the same."
        >
          <div className={overridesStyles.overridesTable}>
          <DataTable<StatementOverrideRow>
            rowKey="batchId"
            pagination={false}
            dataSource={r.statementOverride}
            columns={[
              flexColumn<StatementOverrideRow>({ title: "Bank account", key: "account", floor: OVERRIDE_ACCOUNT_FLOOR, render: (_, row) => row.accountName }),
              flexColumn<StatementOverrideRow>({
                title: "File",
                floor: OVERRIDE_FILE_FLOOR,
                key: "file",
                render: (_, row) => <span title={row.filename}>{row.filename}</span>,
              }),
              {
                title: "Imported",
                key: "imported",
                width: OVERRIDE_IMPORTED_WIDTH,
                render: (_, row) => `${row.importedDate} ${row.importedTime}`,
              },
              flexColumn<StatementOverrideRow>({ title: "By", key: "by", floor: OVERRIDE_BY_FLOOR, render: (_, row) => row.byName }),
              {
                title: "Out by",
                key: "outBy",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => money(row.outByMinor),
              },
              sentenceColumn<StatementOverrideRow>({ title: "Reason", key: "reason", floor: OVERRIDE_REASON_FLOOR, render: (_, row) => row.reason }),
              {
                title: "Open since",
                key: "since",
                width: OVERRIDE_SINCE_WIDTH,
                render: (_, row) => shortDate(row.openSince),
              },
            ]}
          />
          </div>
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.transferOneSide}
          note={transferNote({
            flagged: r.transferOneSide,
            notYetCheckable: r.transferSummary.notYetCheckable,
            corrected: r.transferSummary.corrected,
            skipped: r.transferSummary.skipped,
          })}
          state={state("transferOneSide", r.transferOneSide.length)}
          why="A transfer has two legs, one on each bank account’s statement. One leg cleared and the other did not, although that account’s statements already cover the date and the transfer is more than 30 days old. The money may have gone somewhere else; the last column says where another account shows it. A transfer a later entry has already moved on is counted as corrected, not listed."
        >
          <div className={integrityStyles.transferTable}>
            <DataTable<TransferOneSideRow>
              rowKey="entryId"
              pagination={false}
              dataSource={r.transferOneSide}
              columns={[
                {
                  title: "Entry",
                  key: "entry",
                  width: TRANSFER_ENTRY_WIDTH,
                  render: (_, row) => (
                    <span>
                      <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={() => setOpenEntry(row.entryId)}>
                        {row.entryNumber}
                      </Button>
                      <br />
                      <span className={styles.muted}>{shortDate(row.entryDate)}</span>
                    </span>
                  ),
                },
                { title: "Amount", key: "amount", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.amountMinor) },
                sentenceColumn<TransferOneSideRow>({
                  title: "Cleared on",
                  key: "cleared",
                  floor: TRANSFER_CLEARED_FLOOR,
                  render: (_, row) => (
                    <span>
                      {row.clearedAccountName}
                      <br />
                      <span className={styles.muted}>{shortDate(row.clearedStatementDate)} statement</span>
                    </span>
                  ),
                }),
                sentenceColumn<TransferOneSideRow>({
                  title: "Not cleared on",
                  key: "open",
                  floor: TRANSFER_OPEN_FLOOR,
                  render: (_, row) => row.openAccountName,
                }),
                sentenceColumn<TransferOneSideRow>({
                  title: "Where it went",
                  key: "destination",
                  floor: TRANSFER_DESTINATION_FLOOR,
                  render: (_, row) => (
                    <span>
                      {destinationSentence(row.destinationName)}
                      {candidateNote(row.candidateCount) ? (
                        <>
                          <br />
                          <span className={styles.muted}>{candidateNote(row.candidateCount)}</span>
                        </>
                      ) : null}
                    </span>
                  ),
                }),
              ]}
            />
          </div>
          {r.transferSummary.corrected.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              {r.transferSummary.corrected.map((c) => (
                <div key={c.entryId} className={styles.muted}>
                  {correctedSentence(c, c.movedToName, money)}
                </div>
              ))}
            </div>
          ) : null}
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
                value: report.unavailable.length > 0 ? `${report.checksRun - report.unavailable.length} of ${report.checksRun}` : report.checksRun,
              },
            ]}
          />
          {report.unavailable.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 20 }}
              title={`${report.unavailable.length} of ${report.checksRun} checks could not be run`}
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
              <span className={styles.muted}>Running thirteen checks over the books…</span>
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
