"use client";

import { useEffect, useState } from "react";
import { Alert, Drawer, Skeleton } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { SourceTag, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { COLUMN } from "@/lib/design/table-metrics";
import { dayBefore } from "@/lib/domain/fiscal";
import { longDate, rangeText, shortDate } from "@/lib/domain/report-presets";
import type { ZoomSpec } from "@/lib/domain/statement";
import type { ZoomResult, ZoomRow } from "@/lib/domain/zoom";
import { zoomAction } from "@/app/(app)/reports/actions";

/**
 * QuickZoom (the prototype's `drillDetail`): every posted line behind the
 * figure that was clicked, adding up to it. A line opens the whole entry on
 * top; closing that comes back here.
 */
export default function ZoomSheet({
  spec,
  onClose,
  money,
}: {
  spec: ZoomSpec | null;
  onClose: () => void;
  money: (minor: number) => string;
}) {
  const [loaded, setLoaded] = useState<{ spec: ZoomSpec; result: ZoomResult | null; error: string | null } | null>(null);
  const [openEntry, setOpenEntry] = useState<{ spec: ZoomSpec; entryId: string } | null>(null);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    zoomAction(spec)
      .then((r) => {
        if (cancelled) return;
        setLoaded(
          r.ok && r.data
            ? { spec, result: r.data, error: null }
            : { spec, result: null, error: r.error ?? "The entries could not be read." },
        );
      })
      .catch(() => {
        // A dropped connection rejects rather than returning an error; say so instead of spinning.
        if (!cancelled) {
          setLoaded({ spec, result: null, error: "The entries could not be read. Check the connection and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  // What was read for an earlier figure is not this one's.
  const current = loaded && loaded.spec === spec ? loaded : null;
  const result = current?.result ?? null;
  const error = current?.error ?? null;

  // An entry opened from an earlier figure is not this one's.
  const entryId = openEntry && openEntry.spec === spec ? openEntry.entryId : null;

  const dates = spec ? (spec.from ? rangeText(spec.from, spec.to) : `All dates through ${longDate(spec.to)}`) : "";
  const columns = [
    { title: "Date", key: "date", width: 108, render: (_: unknown, r: ZoomRow) => shortDate(r.entryDate) },
    {
      title: "Type",
      key: "type",
      width: 170,
      render: (_: unknown, r: ZoomRow) => <SourceTag sourceType={r.sourceType} number={r.entryNumber} />,
    },
    flexColumn<ZoomRow>({ title: "Name", key: "name", floor: 140, render: (_, r) => <span title={r.name}>{r.name || "—"}</span> }),
    flexColumn<ZoomRow>({
      title: result?.single ? "Split" : "Account",
      key: "detail",
      floor: 120,
      render: (_, r) => (
        <span className={styles.muted} title={r.detail}>
          {r.detail}
        </span>
      ),
    }),
    {
      title: "Amount",
      key: "amount",
      width: COLUMN.MONEY_WIDE,
      align: "right" as const,
      render: (_: unknown, r: ZoomRow) => <span className={r.amount < 0 ? styles.negative : undefined}>{money(r.amount)}</span>,
    },
    ...(result?.single
      ? [
          {
            title: "Balance",
            key: "balance",
            width: COLUMN.MONEY_WIDE,
            align: "right" as const,
            render: (_: unknown, r: ZoomRow) => (r.balance === null ? "" : money(r.balance)),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      open={spec !== null}
      onClose={onClose}
      size={860}
      destroyOnHidden
      title={
        <div>
          <div className={styles.sheetTitle}>{spec?.title}</div>
          <div className={styles.sheetSub}>{dates} · Accrual basis</div>
        </div>
      }
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : !result ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          {!result.matches ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={`These lines add up to ${money(result.total)}, not the ${money(result.spec.figure)} on the statement.`}
              description="The books changed between the statement and this list. Run the report again."
            />
          ) : null}
          {result.opening !== null && spec?.from ? (
            <p className={styles.muted}>
              Balance on {shortDate(dayBefore(spec.from))}: {money(result.opening)}
            </p>
          ) : null}
          {/* `rows`: paged in the browser, since a total over all dates can stand on thousands of lines. */}
          <DataTable<ZoomRow>
            rowKey="key"
            rows={result.rows}
            columns={columns}
            rowClassName={() => styles.clickable}
            onRow={(r) => ({ onClick: () => spec && setOpenEntry({ spec, entryId: r.entryId }), title: "Open this entry" })}
            emptyTitle="No entries"
            emptyDescription="Nothing was posted to these accounts in these dates."
          />
          <div className={styles.zoomTotal}>
            <span>
              {result.rows.length.toLocaleString("en-US")} {result.rows.length === 1 ? "line" : "lines"}
            </span>
            <strong>Total {money(result.total)}</strong>
          </div>
        </>
      )}
      <EntryDetailDrawer entryId={entryId} onClose={() => setOpenEntry(null)} />
    </Drawer>
  );
}
