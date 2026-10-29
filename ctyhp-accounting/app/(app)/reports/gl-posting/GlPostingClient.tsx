"use client";
import { sourceLabel } from "@/lib/domain/entry-detail";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, App, Segmented, Space, Statistic, Table, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import ReportBar from "@/components/reports/ReportBar";
import { presetRange, type PeriodPreset, type PresetContext } from "@/lib/domain/report-presets";
import { formatDate, formatMoney } from "@/lib/format";
import {
  describeControlExceptions,
  describePostingExceptions,
  controlSheet,
  postingSheet,
  POSTING_VERDICT_LABEL,
  SOURCE_TYPE_LABEL,
  type ControlCheck,
  type ControlReconciliation,
  type PostingCheck,
  type PostingReport,
  type PostingVerdict,
} from "@/lib/domain/gl-posting";
import { controlReconciliationAction, postingReportAction } from "./actions";
import { tokenVar } from "@/lib/design/tokens";

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
  presets,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  presets: PresetContext;
}) {
  const { message } = App.useApp();
  const initial = useMemo(() => presetRange("month", presets), [presets]);
  const [view, setView] = useState<"documents" | "controls">("documents");
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [asOf, setAsOf] = useState(presets.today);
  /** The dates the report on screen was run for. */
  const [ran, setRan] = useState({ from: initial.from, to: initial.to, asOf: presets.today });
  const [report, setReport] = useState<PostingReport | null>(null);
  const [recon, setRecon] = useState<ControlReconciliation | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) =>
      formatMoney(minor, baseCurrency, baseDecimals),
    [baseCurrency, baseDecimals],
  );

  const load = useCallback(
    async (f: string, t: string, a: string) => {
      setLoading(true);
      const [posting, control] = await Promise.all([postingReportAction(f, t), controlReconciliationAction(a)]);
      setLoading(false);
      if (posting.ok && posting.data) setReport(posting.data);
      else message.error(posting.error ?? "Failed to read the posting report");
      if (control.ok && control.data) setRecon(control.data);
      else message.error(control.error ?? "Failed to reconcile the control accounts");
      setRan({ from: f, to: t, asOf: a });
    },
    [message],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(initial.from, initial.to, presets.today);
    // Runs once on arrival; a period choice or Run report runs it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom") return;
    const range = presetRange(key, presets);
    setFrom(range.from);
    setTo(range.to);
    void load(range.from, range.to, asOf);
  };

  const sheet = useMemo(() => {
    const ctx = { companyName, currencyCode: baseCurrency, decimals: baseDecimals };
    if (view === "documents") return report ? postingSheet(report, { ...ctx, from: ran.from, to: ran.to }) : null;
    return recon ? controlSheet(recon, ctx) : null;
  }, [view, report, recon, ran, companyName, baseCurrency, baseDecimals]);

  const postingWarning = report ? describePostingExceptions(report) : null;
  const controlWarning = recon ? describeControlExceptions(recon) : null;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <ReportBar
        leading={
          <Segmented
            value={view}
            onChange={(value) => setView(value as "documents" | "controls")}
            options={[
              { label: `Documents to ledger${report ? ` (${report.summary.documents})` : ""}`, value: "documents" },
              {
                label: `Control accounts${recon ? ` (${recon.rows.length})` : ""}`,
                value: "controls",
              },
            ]}
          />
        }
        dates={
          view === "documents"
            ? {
                kind: "range",
                preset,
                from,
                to,
                onPreset: choosePreset,
                onFrom: (d) => {
                  setFrom(d);
                  setPreset("custom");
                },
                onTo: (d) => {
                  setTo(d);
                  setPreset("custom");
                },
              }
            : { kind: "asOf", to: asOf, onTo: setAsOf }
        }
        onRun={() => void load(from, to, asOf)}
        loading={loading}
        sheet={sheet}
      />

      {/* The two banners answer the reviewer's question without reading a row. */}
      {report ? (
        <Alert
          type={postingWarning ? "error" : "success"}
          showIcon
          message={
            postingWarning ??
            `Every document between ${formatDate(ran.from)} and ${formatDate(ran.to)} ` +
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
            `Every control account ties to its subledger as of ${formatDate(recon.asOf)}.`
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
                valueStyle={report.summary.exceptions ? { color: tokenVar("intent.danger") } : undefined}
              />
              <Statistic title={`Live total (${baseCurrency})`} value={money(report.summary.liveTotalMinor)} />
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
                render: (value: string) => SOURCE_TYPE_LABEL[value] ?? sourceLabel(value),
              },
              {
                title: "Document",
                dataIndex: "documentNumber",
                width: COLUMN.CODE,
                render: (value: string | null) => value ?? <i>unnumbered</i>,
              },
              { title: "Date", dataIndex: "documentDate", width: COLUMN.DATE, render: (v: string) => formatDate(v) },
              // The elastic column: the journal entry used to be a column of
              // its own, 160px printing a reference that belongs to the row it
              // is on.
              flexColumn<PostingCheck>({
                title: "Name",
                key: "partyName",
                render: (_: unknown, row: PostingCheck) => (
                  <div style={{ minWidth: 0 }}>
                    <span title={row.partyName ?? ""}>{row.partyName ?? "—"}</span>
                    {secondaryLine(
                      row.entryNumber ? (
                        <Link href={`/reports/journal?entry=${row.journalEntryId}`}>
                          {row.entryNumber}
                        </Link>
                      ) : (
                        "Not posted"
                      ),
                    )}
                  </div>
                ),
              }),
              {
                title: "Status",
                dataIndex: "documentStatus",
                width: COLUMN.STATUS,
                render: (v: string | null) => <StatusTag status={v} />,
              },
              {
                title: "Amount",
                dataIndex: "amountMinor",
                width: COLUMN.MONEY,
                align: "right",
                render: (value: number) => money(value),
              },
              {
                title: "Posting",
                key: "verdict",
                width: 150,
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
                  <Tag color="green">Ties out</Tag>
                ) : (
                  <b style={{ color: tokenVar("intent.danger") }}>{money(row.varianceMinor)}</b>
                ),
            },
          ]}
          summary={() =>
            recon ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <b>As of {formatDate(recon.asOf)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {recon.allTieOut ? (
                    <Tag color="green">All tie out</Tag>
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
