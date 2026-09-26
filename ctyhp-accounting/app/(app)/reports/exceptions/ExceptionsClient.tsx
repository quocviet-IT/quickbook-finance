"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Space, Statistic, Tag, Typography, type TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { TOKENS } from "@/lib/design/tokens";
import { fromMinor } from "@/lib/domain/money";
import { ACCOUNT_TYPE_LABEL } from "@/lib/domain/accounts";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import {
  CHECK_LABEL,
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

/**
 * The Exception Report.
 *
 * Every section is drawn, including the ones with nothing in them: a reviewer
 * has to see that a check ran, not watch it disappear. Nothing on this screen
 * writes.
 */
export default function ExceptionsClient({
  companyName,
  baseCurrency,
  baseDecimals,
  fiscalStartMonth,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  fiscalStartMonth: number;
}) {
  const today = dayjs();
  // The current fiscal year, not the calendar year: for a company whose year
  // starts in July, "this year" on 2026-09-26 began 2026-07-01, not 2026-01-01.
  const fiscalYearStart = fiscalMonths(
    fiscalYearForDate(today.format("YYYY-MM-DD"), fiscalStartMonth),
    fiscalStartMonth,
  )[0].start;
  const [from, setFrom] = useState<Dayjs>(dayjs(fiscalYearStart));
  const [to, setTo] = useState<Dayjs>(today);
  const [report, setReport] = useState<ExceptionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
        maximumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  const run = useCallback(async () => {
    if (from.isAfter(to)) {
      setError("The start date is after the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await exceptionReportAction(from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD"));
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The report could not be produced.");
      setReport(null);
      return;
    }
    setReport(result.data);
  }, [from, to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // Run once on arrival; afterwards the button is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entryLink = (row: TransactionListRow) => (
    <Link href={`/reports/journal?entry=${row.entryId}`}>{row.entryNumber}</Link>
  );

  /**
   * Date / Entry / Name / Split / Amount.
   *
   * Shared by the duplicates and future-dated sections below, which listed a
   * journal entry the same way — the same five columns, declared twice.
   */
  const transactionColumns: TableColumnsType<TransactionListRow> = [
    { title: "Date", dataIndex: "entryDate", width: COLUMN.DATE },
    { title: "Entry", key: "entry", width: COLUMN.CODE, render: (_, r) => entryLink(r) },
    flexColumn<TransactionListRow>({ title: "Name", dataIndex: "partyName" }),
    flexColumn<TransactionListRow>({ title: "Split", dataIndex: "categoryLabel" }),
    {
      title: "Amount",
      dataIndex: "amountMinor",
      width: COLUMN.MONEY,
      align: "right",
      render: (_, r) => money(r.amountMinor),
    },
  ];

  const exportCsv = () => {
    if (!report) return;
    const lines: string[] = ["Check,Date,Reference,Name,Account,Amount"];
    const push = (check: string, date: string, ref: string, name: string, acct: string, amount: string) =>
      lines.push([check, date, ref, name, acct, amount].map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(","));

    report.duplicates.forEach((g) =>
      g.entries.forEach((e) =>
        push("Recorded more than once", e.entryDate, e.entryNumber, e.partyName ?? "", e.categoryLabel ?? "", money(e.amountMinor)),
      ),
    );
    report.checkNumberClashes.forEach((c) =>
      c.payments.forEach((p) =>
        push("Check number used twice", p.paymentDate, p.reference, p.partyName, c.accountName, money(p.amountMinor)),
      ),
    );
    report.undeposited.forEach((u) =>
      push("Received but not banked", u.oldestEntryDate ?? "", "", "", u.name, money(u.balanceMinor)),
    );
    report.wrongWay.forEach((w) =>
      push("Balance pointing the wrong way", to.format("YYYY-MM-DD"), w.accountCode, ACCOUNT_TYPE_LABEL[w.accountType], w.name, money(w.balanceMinor)),
    );
    report.incomeNoCost.forEach((y) =>
      push("Income with no costs", `${y.year}-12-31`, y.year, "", "", money(y.incomeMinor)),
    );
    report.unreconciled.forEach((u) =>
      push("Not agreed to a statement", u.lastReconciledDate ?? "never", "", "", u.accountName, money(u.balanceMinor)),
    );
    report.futureDated.forEach((e) =>
      push("Dated in the future", e.entryDate, e.entryNumber, e.partyName ?? "", e.categoryLabel ?? "", money(e.amountMinor)),
    );
    report.holding.forEach((h) =>
      push("Still in a holding account", to.format("YYYY-MM-DD"), h.accountCode, "", h.name, money(h.balanceMinor)),
    );
    // A check named here contributed no rows above, and no rows is exactly
    // what a check that found nothing also looks like. This file is the
    // artifact of "somebody has looked", so it has to be able to say "could
    // not look" too, or the one case where the books need a second try reads
    // as the one case where they are clean.
    report.unavailable.forEach((key) =>
      push(CHECK_LABEL[key], "", "", "Could not be run", "", ""),
    );

    const csv = csvWithReportIdentity(lines.join("\n"), {
      companyName,
      title: "Exception Report",
      subtitle: `${from.format("YYYY-MM-DD")} to ${to.format("YYYY-MM-DD")}`,
      currencyCode: baseCurrency,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exception-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * One section.
   *
   * A check whose data could not be read says so. "Nothing found" would be a
   * different answer, and the wrong one.
   */
  const section = (
    check: CheckKey,
    count: number,
    why: string,
    body: React.ReactNode,
    allDates = false,
  ) => {
    const missing = report?.unavailable.includes(check) ?? false;
    return (
      <div key={check} style={{ marginBottom: 28 }}>
        <Space align="center" wrap style={{ marginBottom: 6 }}>
          <Typography.Text strong>{CHECK_LABEL[check]}</Typography.Text>
          {allDates ? <Tag>All dates</Tag> : null}
          {missing ? (
            <Tag color="orange">Could not run</Tag>
          ) : count > 0 ? (
            <Tag color="volcano">{count} to look at</Tag>
          ) : (
            <Tag color="green">Nothing found</Tag>
          )}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
          {why}
        </Typography.Paragraph>
        {missing ? (
          <Typography.Text type="secondary">
            This check could not be run, so it is not saying the books are clear.
          </Typography.Text>
        ) : count > 0 ? (
          body
        ) : (
          <Typography.Text type="secondary">No exceptions.</Typography.Text>
        )}
      </div>
    );
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 20 }}>
        <DatePicker value={from} onChange={(d) => d && setFrom(d)} allowClear={false} />
        <DatePicker value={to} onChange={(d) => d && setTo(d)} allowClear={false} />
        <Button type="primary" onClick={() => void run()} loading={loading}>
          Run
        </Button>
        <Button onClick={exportCsv} disabled={!report}>
          Export CSV
        </Button>
      </Space>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} /> : null}

      {report && report.unavailable.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`${report.unavailable.length} of 8 checks could not be run`}
          description={
            <>
              {report.unavailable.map((c) => CHECK_LABEL[c]).join("; ")}. The rest of the report is
              complete. A check that could not run is not saying the books are clear.
            </>
          }
        />
      ) : null}

      {report ? (
        <>
          <Space size="large" wrap style={{ marginBottom: 24 }}>
            <Statistic title="Entries examined" value={report.entriesExamined} />
            <Statistic
              title="Questions raised"
              value={report.questionsRaised}
              valueStyle={report.questionsRaised > 0 ? { color: TOKENS.intent.danger } : undefined}
            />
            <Statistic title="Checks run" value={report.checksRun} />
          </Space>

          {section(
            "duplicates",
            report.duplicates.length,
            "Same date, same name, same reference, same accounts, same amount. Repeated wages on one day are normal when several people are paid the same; the same supplier paid twice usually is not.",
            <DataTable<TransactionListRow>
              rowKey="entryId"
              pagination={false}
              dataSource={report.duplicates.flatMap((g) => g.entries)}
              columns={transactionColumns}
            />,
          )}

          {section(
            "checkNumber",
            report.checkNumberClashes.length,
            "Counted per bank account, so the same number in two different check books is not flagged. Two entries against one number on one account means one of them is miscoded, or the check was reissued.",
            <DataTable<ExceptionPaymentRef>
              rowKey="paymentId"
              pagination={false}
              dataSource={report.checkNumberClashes.flatMap((c) => c.payments)}
              columns={[
                flexColumn<ExceptionPaymentRef>({ title: "Account", dataIndex: "accountName" }),
                { title: "Number", dataIndex: "reference", width: COLUMN.CODE },
                { title: "Date", dataIndex: "paymentDate", width: COLUMN.DATE },
                flexColumn<ExceptionPaymentRef>({ title: "Name", dataIndex: "partyName" }),
                {
                  title: "Amount",
                  dataIndex: "amountMinor",
                  width: COLUMN.MONEY,
                  align: "right",
                  render: (_, r) => money(r.amountMinor),
                },
              ]}
            />,
          )}

          {section(
            "undeposited",
            report.undeposited.length,
            "Undeposited funds should empty as takings reach the bank. A balance that keeps growing means the sales are recorded but the deposits are not — revenue is in the books, the cash is not.",
            <DataTable<UndepositedRow>
              rowKey="accountId"
              pagination={false}
              dataSource={report.undeposited}
              columns={[
                flexColumn<UndepositedRow>({ title: "Account", dataIndex: "name" }),
                {
                  title: "Balance",
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.balanceMinor),
                },
                {
                  title: "Entries",
                  dataIndex: "entryCount",
                  width: COLUMN.QTY,
                  render: (_, r) => (r.entryCount === null ? "—" : r.entryCount),
                },
                {
                  title: "Oldest",
                  dataIndex: "oldestEntryDate",
                  width: COLUMN.DATE,
                  render: (_, r) => r.oldestEntryDate ?? "—",
                },
              ]}
            />,
          )}

          {section(
            "wrongWay",
            report.wrongWay.length,
            "An asset in credit or a liability in debit. Sometimes right — an overdrawn account, a supplier overpaid — and sometimes a posting on the wrong side. Contra accounts are left out of this check.",
            <DataTable<WrongWayRow>
              rowKey="accountId"
              pagination={false}
              dataSource={report.wrongWay}
              columns={[
                flexColumn<WrongWayRow>({ title: "Account", dataIndex: "name" }),
                {
                  title: "Type",
                  dataIndex: "accountType",
                  width: 150,
                  render: (_, r) => <Tag>{ACCOUNT_TYPE_LABEL[r.accountType]}</Tag>,
                },
                {
                  title: `Balance as of ${to.format("YYYY-MM-DD")}`,
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.balanceMinor),
                },
              ]}
            />,
          )}

          {section(
            "incomeNoCost",
            report.incomeNoCost.length,
            "Revenue with nothing spent against it almost always means the period is only part-entered. The profit shown for that year is not a profit.",
            <DataTable<IncomeNoCostRow>
              rowKey="year"
              pagination={false}
              dataSource={report.incomeNoCost}
              columns={[
                { title: "Year", dataIndex: "year", width: COLUMN.QTY },
                {
                  title: "Income",
                  dataIndex: "incomeMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.incomeMinor),
                },
                {
                  title: "Costs",
                  dataIndex: "costMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.costMinor),
                },
              ]}
            />,
            true,
          )}

          {section(
            "unreconciled",
            report.unreconciled.length,
            "A balance nobody has proved against the bank. Reconcile it on the Banking screen.",
            <DataTable<UnreconciledRow>
              rowKey="bankAccountId"
              pagination={false}
              dataSource={report.unreconciled}
              columns={[
                flexColumn<UnreconciledRow>({ title: "Account", dataIndex: "accountName" }),
                {
                  title: "Balance",
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.balanceMinor),
                },
                {
                  title: "Last reconciled",
                  dataIndex: "lastReconciledDate",
                  width: 130,
                  render: (_, r) => (r.lastReconciledDate ? r.lastReconciledDate : <Tag color="volcano">never</Tag>),
                },
              ]}
            />,
          )}

          {section(
            "futureDated",
            report.futureDated.length,
            "Dated after today. Usually a typing slip in the year.",
            <DataTable<TransactionListRow>
              rowKey="entryId"
              pagination={false}
              dataSource={report.futureDated}
              columns={transactionColumns}
            />,
            true,
          )}

          {section(
            "holding",
            report.holding.length,
            "Anything left in Uncategorized has not been given an account yet, so it is in the wrong place on both statements.",
            <DataTable<HoldingRow>
              rowKey="accountId"
              pagination={false}
              dataSource={report.holding}
              columns={[
                flexColumn<HoldingRow>({ title: "Account", dataIndex: "name" }),
                {
                  title: "Balance",
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (_, r) => money(r.balanceMinor),
                },
              ]}
            />,
          )}

          <Typography.Paragraph type="secondary" style={{ marginTop: 28 }}>
            <strong>Nothing here is proof of a mistake.</strong> Each line is a question a reviewer
            would ask, and most have an innocent answer — four wages of the same amount on one day, a
            check book that restarts at 1000. What matters is that somebody has looked and can say
            why.
          </Typography.Paragraph>
        </>
      ) : null}
    </div>
  );
}
