"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Select, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import {
  reconciliationListSheet,
  type ReconciliationListLine,
  type ReconciliationListReport,
} from "@/lib/domain/reconciliation-list";
import { longDate, shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const PAGE_SIZE = 50;

/**
 * Reconciliation Report: every signed-off statement reconciliation, newest
 * first within each bank account, and whether it still agrees with the books.
 */
export default function ReconciliationsClient({
  companyName,
  currencyCode,
  decimals,
  today,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<ReconciliationListReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<{ value: string; label: string }[]>([]);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);

  const view = useCallback(
    (report: ReconciliationListReport): ReconciliationListReport => {
      const lines = account ? report.lines.filter((line) => line.bankAccountId === account) : report.lines;
      return { lines, outOfAgreement: lines.filter((line) => !line.stillAgrees).length };
    },
    [account],
  );
  const sheet = useCallback(
    (report: ReconciliationListReport) =>
      reconciliationListSheet(report, { companyName, today, currencyCode, baseDecimals: decimals, timeZone }),
    [companyName, today, currencyCode, decimals, timeZone],
  );
  const listAccounts = useCallback((report: ReconciliationListReport) => {
    const seen = new Map<string, string>();
    for (const line of report.lines) seen.set(line.bankAccountId, line.bankAccountName);
    setAccounts([...seen].map(([value, label]) => ({ value, label })));
  }, []);
  const caption = useMemo(() => `Signed-off reconciliations, as of ${longDate(today)}`, [today]);

  return (
    <SimpleReport<ReconciliationListReport>
      companyName={companyName}
      title="Reconciliation Report"
      currencyCode={currencyCode}
      period={{ kind: "none", today, caption }}
      load={load}
      onLoaded={listAccounts}
      view={view}
      sheet={sheet}
      runningText="Checking every signed-off reconciliation…"
      filters={
        <Select
          allowClear
          aria-label="Bank account"
          placeholder="All bank accounts"
          style={{ minWidth: 240 }}
          value={account ?? undefined}
          onChange={(value) => setAccount(value ?? null)}
          options={accounts}
        />
      }
      render={(report, _when, { printing }) => (
        <>
          <StatRow
            items={[
              { label: "Signed off", value: report.lines.length.toLocaleString("en-US") },
              { label: "No longer agree", value: report.outOfAgreement, danger: report.outOfAgreement > 0 },
            ]}
          />
          <DataTable<ReconciliationListLine>
            rowKey="id"
            dataSource={report.lines}
            pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
            emptyTitle={account ? "No signed-off reconciliation for this bank account" : "No reconciliation has been signed off"}
            emptyDescription={
              account
                ? "Choose All bank accounts, or another account."
                : "Reconcile a bank account against its statement under Banking › Reconcile."
            }
            columns={[
              flexColumn<ReconciliationListLine>({ title: "Bank account", dataIndex: "bankAccountName" }),
              {
                title: "Statement ending",
                dataIndex: "statementEndingDate",
                width: COLUMN.DATE + 32,
                render: (d: string) => shortDate(d),
              },
              {
                title: "Ending balance",
                dataIndex: "statementEndingBalanceMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => money(minor),
              },
              {
                title: "Signed off",
                key: "signed",
                width: 220,
                render: (_: unknown, line: ReconciliationListLine) => (
                  <span>
                    {line.completedAt ? stampInTimeZone(line.completedAt, timeZone) : "—"}
                    {line.completedByName ? <span className={styles.muted}> · {line.completedByName}</span> : null}
                  </span>
                ),
              },
              {
                title: "Still agrees",
                key: "agrees",
                width: 190,
                render: (_: unknown, line: ReconciliationListLine) =>
                  line.stillAgrees ? (
                    <Tag color="green">Yes</Tag>
                  ) : (
                    <span title={`Voided since: ${line.voidedEntries.join(", ")}`}>
                      <Tag color="red">No</Tag>
                      <span className={styles.negative}>out by {money(line.differenceMinor)}</span>
                    </span>
                  ),
              },
              {
                title: "",
                key: "open",
                width: 70,
                render: (_: unknown, line: ReconciliationListLine) => (
                  <Link href={`/banking/reconcile/${line.id}/report`}>Open</Link>
                ),
              },
            ]}
          />
          <ReportFoot>
            <strong>Still agrees</strong> means none of the entries the reconciliation ticked has been voided since it was
            signed off. When one has, the reconciliation is out by that entry’s amount; hover over No to see which
            entries, and open the reconciliation to deal with it.
          </ReportFoot>
        </>
      )}
    />
  );
}
