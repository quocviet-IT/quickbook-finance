"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, DatePicker, Segmented, Space, Statistic, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { fromMinor } from "@/lib/domain/money";
import {
  describeControlExceptions,
  describePostingExceptions,
  POSTING_VERDICT_LABEL,
  SOURCE_TYPE_LABEL,
  type ControlCheck,
  type ControlReconciliation,
  type PostingCheck,
  type PostingReport,
  type PostingVerdict,
} from "@/lib/domain/gl-posting";
import { controlReconciliationAction, postingReportAction } from "./actions";
import { TOKENS } from "@/lib/design/tokens";

const VERDICT_COLOR: Record<PostingVerdict, string> = {
  posted: "green",
  missing_entry: "red",
  entry_not_posted: "red",
  amount_mismatch: "red",
  off_ledger: "default",
  posted_in_error: "red",
};

/**
 * Proof that every document reached the ledger, and that every control account
 * still agrees with what stands behind it.
 *
 * The posting in this system is atomic with the document, so this screen should
 * be boring every day. That is the point: an assurance nobody can see is not an
 * assurance, and the day it stops being boring is the day someone needs to know.
 */
export default function GlPostingClient({
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [view, setView] = useState<"documents" | "controls">("documents");
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf("month"));
  const [to, setTo] = useState<Dayjs>(dayjs());
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [report, setReport] = useState<PostingReport | null>(null);
  const [recon, setRecon] = useState<ControlReconciliation | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [posting, control] = await Promise.all([
      postingReportAction(from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD")),
      controlReconciliationAction(asOf.format("YYYY-MM-DD")),
    ]);
    setLoading(false);
    if (posting.ok && posting.data) setReport(posting.data);
    else message.error(posting.error ?? "Failed to read the posting report");
    if (control.ok && control.data) setRecon(control.data);
    else message.error(control.error ?? "Failed to reconcile the control accounts");
  }, [from, to, asOf, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Loads once for today; the button re-runs it after a date change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postingWarning = report ? describePostingExceptions(report) : null;
  const controlWarning = recon ? describeControlExceptions(recon) : null;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Segmented
          value={view}
          onChange={(value) => setView(value as "documents" | "controls")}
          options={[
            { label: `Documents → ledger${report ? ` (${report.summary.documents})` : ""}`, value: "documents" },
            {
              label: `Control accounts${recon ? ` (${recon.rows.length})` : ""}`,
              value: "controls",
            },
          ]}
        />
        {view === "documents" ? (
          <>
            <DatePicker value={from} onChange={(d) => d && setFrom(d)} allowClear={false} />
            <DatePicker value={to} onChange={(d) => d && setTo(d)} allowClear={false} />
          </>
        ) : (
          <DatePicker value={asOf} onChange={(d) => d && setAsOf(d)} allowClear={false} />
        )}
        <Button type="primary" loading={loading} onClick={load}>
          Run report
        </Button>
      </Space>

      {/* The two banners answer the reviewer's question without reading a row. */}
      {report ? (
        <Alert
          type={postingWarning ? "error" : "success"}
          showIcon
          message={
            postingWarning ??
            `Every document between ${from.format("YYYY-MM-DD")} and ${to.format("YYYY-MM-DD")} ` +
              `is accounted for: ${report.summary.posted} posted, ${report.summary.offLedger} correctly off the ledger.`
          }
        />
      ) : null}
      {recon ? (
        <Alert
          type={controlWarning ? "error" : "success"}
          showIcon
          message={
            controlWarning ??
            `Every control account ties to its subledger as of ${recon.asOf}.`
          }
        />
      ) : null}

      {view === "documents" ? (
        <>
          {report ? (
            <Space size="large" wrap>
              <Statistic title="Documents" value={report.summary.documents} />
              <Statistic title="Posted" value={report.summary.posted} />
              <Statistic title="Off the ledger" value={report.summary.offLedger} />
              <Statistic
                title="Exceptions"
                value={report.summary.exceptions}
                valueStyle={report.summary.exceptions ? { color: TOKENS.intent.danger } : undefined}
              />
              <Statistic title={`Live total (${baseCurrency})`} value={money(report.summary.liveTotalMinor)} />
              <ReportExportButtons
                disabled={report.rows.length === 0}
                sheet={{
                  fileName: `gl-posting-${from.format("YYYY-MM-DD")}-${to.format("YYYY-MM-DD")}`,
                  companyName,
                  title: "General Ledger Posting",
                  subtitle: `${from.format("YYYY-MM-DD")} to ${to.format("YYYY-MM-DD")}`,
                  currencyCode: baseCurrency,
                  columns: [
                    { key: "type", header: "Type", kind: "text" },
                    { key: "number", header: "Document", kind: "text" },
                    { key: "date", header: "Date", kind: "text" },
                    { key: "party", header: "Name", kind: "text" },
                    { key: "status", header: "Status", kind: "text" },
                    { key: "amount", header: "Amount", kind: "money" },
                    { key: "entry", header: "Journal entry", kind: "text" },
                    { key: "verdict", header: "Posting", kind: "text" },
                  ],
                  rows: report.rows.map((row) => ({
                    type: SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType,
                    number: row.documentNumber ?? "(unnumbered)",
                    date: row.documentDate,
                    party: row.partyName,
                    status: row.documentStatus,
                    amount: row.amountMinor,
                    entry: row.entryNumber ?? "",
                    verdict: POSTING_VERDICT_LABEL[row.verdict],
                  })),
                }}
              />
            </Space>
          ) : null}

          <DataTable<PostingCheck>
            rowKey={(row) => `${row.sourceType}-${row.documentId}`}
            loading={loading}
            dataSource={report?.rows ?? []}
            emptyTitle="No documents in this period"
            emptyDescription="Widen the dates, or post something first."
            rowClassName={(row) => (row.isException ? "report-table-row--exception" : "")}
            columns={[
              {
                title: "Type",
                dataIndex: "sourceType",
                width: 150,
                render: (value: string) => SOURCE_TYPE_LABEL[value] ?? value,
              },
              {
                title: "Document",
                dataIndex: "documentNumber",
                width: 150,
                render: (value: string | null) => value ?? <i>unnumbered</i>,
              },
              { title: "Date", dataIndex: "documentDate", width: 110 },
              { title: "Name", dataIndex: "partyName" },
              { title: "Status", dataIndex: "documentStatus", width: 100 },
              {
                title: "Amount",
                dataIndex: "amountMinor",
                width: 130,
                align: "right",
                render: (value: number) => money(value),
              },
              {
                title: "Journal entry",
                key: "entry",
                width: 160,
                render: (_: unknown, row) =>
                  row.entryNumber ? (
                    <Link href={`/journal?entry=${row.journalEntryId}`}>{row.entryNumber}</Link>
                  ) : (
                    "—"
                  ),
              },
              {
                title: "Posting",
                key: "verdict",
                width: 170,
                render: (_: unknown, row) => (
                  <Tag color={VERDICT_COLOR[row.verdict]}>{POSTING_VERDICT_LABEL[row.verdict]}</Tag>
                ),
              },
            ]}
          />
        </>
      ) : (
        <Table<ControlCheck>
          rowKey="controlKey"
          loading={loading}
          pagination={false}
          dataSource={recon?.rows ?? []}
          locale={{ emptyText: "Run the report to reconcile the control accounts" }}
          rowClassName={(row) => (row.isException ? "report-table-row--exception" : "")}
          columns={[
            { title: "Control account", dataIndex: "label" },
            {
              title: "Ledger account",
              dataIndex: "accountCodes",
              width: 140,
              render: (value: string | null) => value ?? <i>not configured</i>,
            },
            {
              title: "Subledger",
              key: "subledger",
              width: 150,
              align: "right",
              render: (_: unknown, row) =>
                row.hasSubledger ? money(row.subledgerMinor) : <i>no subledger</i>,
            },
            {
              title: "Ledger balance",
              dataIndex: "controlMinor",
              width: 150,
              align: "right",
              render: (value: number) => money(value),
            },
            {
              title: "Variance",
              key: "variance",
              width: 150,
              align: "right",
              render: (_: unknown, row) =>
                row.tiesOut ? (
                  <Tag color="green">ties out</Tag>
                ) : (
                  <b style={{ color: TOKENS.intent.danger }}>{money(row.varianceMinor)}</b>
                ),
            },
          ]}
          summary={() =>
            recon ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <b>As of {recon.asOf}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {recon.allTieOut ? (
                    <Tag color="green">all tie out</Tag>
                  ) : (
                    <Tag color="red">{recon.exceptions.length} out</Tag>
                  )}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      )}
    </Space>
  );
}
