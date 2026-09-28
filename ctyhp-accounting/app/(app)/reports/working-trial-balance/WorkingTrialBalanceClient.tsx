"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Select, Space, Spin, type TableColumnsType } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { ReportFoot, ReportPaper, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { downloadTextFile } from "@/lib/client/download";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, presetRange, rangeText, shortDate, type PeriodPreset } from "@/lib/domain/report-presets";
import { workingTrialBalanceSheet, type AjeRow, type WorkingTrialBalance } from "@/lib/domain/working-trial-balance";
import { workingTrialBalanceAction } from "./actions";

/** One line of the table: an account, the retained-earnings line, or the total. */
interface Line {
  key: string;
  accountId: string | null;
  label: string;
  total: boolean;
  /** Unadjusted, adjustments, adjusted — each a debit then a credit, in minor units. */
  cells: [number, number, number, number, number, number];
}

const pair = (v: number): [number, number] => [v > 0 ? v : 0, v < 0 ? -v : 0];

/**
 * The Working Trial Balance, laid out as the client's prototype lays it out
 * (`reportWorkingPapers` in Accounting-System-v3.html): a period, the report on
 * paper, three figures, the three column pairs with their total, the adjusting
 * entries listed with the reason for each, and whether the columns agree.
 *
 * Nothing on this screen writes. Marking an entry adjusting is done on the
 * Journal screen, which the footer links to.
 */
export default function WorkingTrialBalanceClient({
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
  const [ran, setRan] = useState(initial);
  const [report, setReport] = useState<WorkingTrialBalance | null>(null);
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
    const result = await workingTrialBalanceAction(f, t);
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
    () => (report ? workingTrialBalanceSheet(report, { companyName, currencyCode: baseCurrency, decimals: baseDecimals }) : null),
    [report, companyName, baseCurrency, baseDecimals],
  );

  const lines = useMemo<Line[]>(() => {
    if (!report) return [];
    const t = report.totals;
    return [
      ...report.rows.map((r) => ({
        key: r.key,
        accountId: r.accountId,
        label: r.accountId ? `${r.accountCode} ${r.name}` : r.name,
        total: false,
        cells: [...pair(r.unadjusted), ...pair(r.adjustment), ...pair(r.adjusted)] as Line["cells"],
      })),
      {
        key: "total",
        accountId: null,
        label: "Total",
        total: true,
        cells: [t.unadjustedDebit, t.unadjustedCredit, t.adjustmentDebit, t.adjustmentCredit, t.adjustedDebit, t.adjustedCredit],
      },
    ];
  }, [report]);

  /* ---------------------------------------------------------- tables */

  const amountColumn = (i: number, look: "plain" | "adjustment" | "adjusted") => ({
    title: i % 2 === 0 ? "Debit" : "Credit",
    key: `c${i}`,
    width: COLUMN.MONEY,
    align: "right" as const,
    render: (_: unknown, r: Line) => {
      const v = r.cells[i];
      if (!r.total && v === 0) return "";
      const text = money(v);
      if (r.total) return text;
      if (look === "adjustment") return <span className={styles.negative}>{text}</span>;
      if (look === "adjusted") return <strong>{text}</strong>;
      return text;
    },
  });

  const columns: TableColumnsType<Line> = [
    flexColumn<Line>({
      title: "Account",
      key: "account",
      render: (_, r) =>
        r.accountId ? (
          <a
            className={styles.accountLink}
            href={`/reports/general-ledger?account=${r.accountId}&from=${ran.from}&to=${ran.to}`}
            target="_blank"
            rel="noopener"
            title="Open this account's ledger in a new tab"
          >
            {r.label}
          </a>
        ) : (
          r.label
        ),
    }),
    { title: "Unadjusted", key: "unadjusted", children: [amountColumn(0, "plain"), amountColumn(1, "plain")] },
    { title: "Adjustments", key: "adjustments", children: [amountColumn(2, "adjustment"), amountColumn(3, "adjustment")] },
    { title: "Adjusted", key: "adjusted", children: [amountColumn(4, "adjusted"), amountColumn(5, "adjusted")] },
  ];

  const ajeColumns: TableColumnsType<AjeRow> = [
    { title: "No.", key: "no", width: 80, render: (_, r) => r.number ?? "" },
    { title: "Date", key: "date", width: 108, render: (_, r) => (r.date ? shortDate(r.date) : "") },
    flexColumn<AjeRow>({ title: "Name", key: "name", floor: 140, render: (_, r) => r.name ?? "" }),
    flexColumn<AjeRow>({
      title: "Account",
      key: "account",
      floor: 140,
      render: (_, r) => <span className={styles.muted}>{r.account}</span>,
    }),
    { title: "Debit", key: "debit", width: COLUMN.MONEY, align: "right", render: (_, r) => (r.debit ? money(r.debit) : "") },
    { title: "Credit", key: "credit", width: COLUMN.MONEY, align: "right", render: (_, r) => (r.credit ? money(r.credit) : "") },
    flexColumn<AjeRow>({ title: "Why", key: "why", floor: 160, render: (_, r) => r.why ?? "" }),
  ];

  /* ---------------------------------------------------------- page */

  const body = (r: WorkingTrialBalance) =>
    r.rows.length === 0 ? (
      <div className={styles.empty}>
        No entries fall in this period.
        <br />
        Add entries on the <Link href="/journal">Journal screen</Link>, or widen the date range.
      </div>
    ) : (
      <>
        <StatRow
          items={[
            { label: "Accounts", value: r.accountCount.toLocaleString("en-US") },
            { label: "Adjusting entries", value: r.adjustingEntryCount, danger: r.adjustingEntryCount > 0 },
            { label: "Adjusted total", value: money(r.totals.adjustedDebit) },
          ]}
        />
        <div className={styles.det}>
          <DataTable<Line>
            rowKey="key"
            pagination={false}
            dataSource={lines}
            columns={columns}
            rowClassName={(line) => (line.total ? styles.totalRow : "")}
          />
        </div>

        {r.adjustments.length > 0 ? (
          <>
            <div className={styles.eyebrow}>The adjustments</div>
            <div className={styles.det}>
              <DataTable<AjeRow>
                rowKey="key"
                pagination={false}
                dataSource={r.adjustments}
                columns={ajeColumns}
                rowClassName={(a) => `${styles.clickable}${a.first && a.number !== "AJE 1" ? ` ${styles.groupStart}` : ""}`}
                onRow={(a) => ({ onClick: () => setOpenEntry(a.entryId), title: "Open this entry" })}
              />
            </div>
          </>
        ) : null}

        <ReportFoot>
          <strong>An entry is an adjustment because you said so.</strong> Open one on the{" "}
          <Link href="/journal">Journal screen</Link> and tick <em>Adjusting entry</em>, with a note saying why. Nothing
          is inferred from the date or the accounts, so the middle column is a list of decisions somebody made and can
          defend, which is the only version worth putting in front of a reviewer.{" "}
          {r.balanced ? (
            "Debits equal credits in all three column pairs."
          ) : (
            <>
              <strong>Note:</strong> the columns do not agree, which should not happen while every entry balances.
            </>
          )}
        </ReportFoot>
      </>
    );

  const paper = (
    <ReportPaper
      companyName={companyName}
      title="Working Trial Balance"
      range={rangeText(ran.from, ran.to)}
      currencyCode={baseCurrency}
    >
      {report ? (
        body(report)
      ) : (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          {loading ? (
            <Space orientation="vertical" size={12}>
              <Spin size="large" />
              <span className={styles.muted}>Reading the books…</span>
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

      {report && loading ? (
        <Spin spinning description="Reading the books again…">
          {paper}
        </Spin>
      ) : (
        paper
      )}

      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
