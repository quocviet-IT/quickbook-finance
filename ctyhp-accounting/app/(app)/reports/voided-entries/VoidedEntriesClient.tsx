"use client";

import { useCallback, useState } from "react";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import type { PresetContext } from "@/lib/domain/report-presets";
import { shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";
import { voidedEntriesSheet, type VoidedEntriesLine, type VoidedEntriesReport } from "@/lib/domain/voided-entries";

const PAGE_SIZE = 50;

/**
 * Voided and Reversed Entries: OneBook's Bin. Every entry voided or reversed in
 * the period, newest first; clicking an entry opens it.
 */
export default function VoidedEntriesClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  timeZone,
  canReadAudit,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  timeZone: string;
  /** Whether the reader may see who voided a document (it comes from the audit log). */
  canReadAudit: boolean;
  load: (when: ReportWhen) => Promise<ReportRunResult<VoidedEntriesReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: VoidedEntriesReport, when: ReportWhen) =>
      voidedEntriesSheet(report, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, baseDecimals: decimals, timeZone }),
    [companyName, currencyCode, decimals, timeZone],
  );
  const entryLink = (id: string, number: string) => (
    <a
      className={styles.accountLink}
      onClick={(event) => {
        event.preventDefault();
        setOpenEntry(id);
      }}
      href="#"
      title="Open this entry"
    >
      <span className={styles.mono}>{number}</span>
    </a>
  );

  return (
    <>
      <SimpleReport<VoidedEntriesReport>
        companyName={companyName}
        title="Voided and Reversed Entries"
        currencyCode={currencyCode}
        period={{ kind: "range", ctx: presets, preset: "year" }}
        load={load}
        sheet={sheet}
        runningText="Reading the voided and reversed entries…"
        render={(report) => (
          <>
            <StatRow
              items={[
                { label: "Voided", value: report.voided.toLocaleString("en-US") },
                { label: "Reversed", value: report.reversed.toLocaleString("en-US") },
              ]}
            />
            <DataTable<VoidedEntriesLine>
              rowKey="key"
              dataSource={report.lines}
              pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
              emptyTitle="Nothing was voided or reversed in this period"
              emptyDescription="Widen the dates."
              columns={[
                { title: "Date", dataIndex: "entryDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Entry",
                  key: "entry",
                  width: COLUMN.CODE,
                  render: (_: unknown, line: VoidedEntriesLine) => entryLink(line.entryId, line.entryNumber),
                },
                flexColumn<VoidedEntriesLine>({
                  title: "Description",
                  key: "description",
                  // The reason sits under what was undone: most voids have none, and a column of dashes
                  // would take the room the description needs.
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <div style={{ minWidth: 0 }}>
                      <span title={line.description}>{line.description || "—"}</span>
                      {line.reason ? secondaryLine(`Reason: ${line.reason}`) : null}
                    </div>
                  ),
                }),
                { title: "Amount", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: (m: number) => money(m) },
                {
                  title: "Action",
                  key: "action",
                  width: 170,
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <span style={{ whiteSpace: "nowrap" }}>
                      <Tag color={line.action === "Voided" ? "red" : "orange"}>{line.action}</Tag>
                      {line.reversalEntryId && line.reversalNumber ? (
                        <span title="The entry that undid it">→ {entryLink(line.reversalEntryId, line.reversalNumber)}</span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  title: "When",
                  key: "when",
                  width: 190,
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <span>
                      {line.actedAt ? stampInTimeZone(line.actedAt, timeZone) : <span className={styles.muted}>Not recorded</span>}
                      {line.by ? <span className={styles.muted}> · {line.by}</span> : null}
                    </span>
                  ),
                },
              ]}
            />
            <ReportFoot>
              <strong>Nothing here can be put back.</strong> OneBook never deletes a posted entry: voiding a document voids its
              entry, and reversing an entry posts a second one that undoes it. To record the transaction again, post it as a
              new entry. An entry voided before the books kept the time of a void is dated by the entry itself.
              {canReadAudit ? null : " Who voided a document is kept in the audit log, which your role cannot read."}
            </ReportFoot>
          </>
        )}
      />
      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}
