"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { DeleteOutlined, PlusOutlined, PrinterOutlined } from "@ant-design/icons";
import { Alert, App, Button, DatePicker, Input, InputNumber, Space } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportFoot, ReportPaper, StatRow } from "@/components/reports/ReportPaper";
import { reportPagination } from "@/components/reports/SimpleReport";
import { downloadTextFile } from "@/lib/client/download";
import { printReport, watchReportPrinting } from "@/lib/client/print-report";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { COLUMN } from "@/lib/design/table-metrics";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import {
  FOOTNOTE,
  PASTE_HINT,
  QUANTITY_DECIMALS,
  adjustButtonLabel,
  adjustButtonState,
  appendCountLines,
  countDifferenceMinor,
  countedTotalMinor,
  differenceTone,
  isDirty,
  lineValueMinor,
  parseCountSheet,
  pasteProblemText,
  pasteSummary,
  settleSavedRows,
  signedAmountText,
  stockCountSheet,
  stockCountStatusLabel,
  validateStockCount,
  type CountProblem,
  type PasteProblem,
  type StockCountLineInput,
} from "@/lib/domain/stock-count";
import { dateInTimeZone } from "@/lib/domain/stamp";
import { formatMoney } from "@/lib/format";
import type { PostingContext } from "@/lib/services/stock-count";
import { bookValueAction, saveStockCountAction } from "./actions";
import PostCountDialog from "./PostCountDialog";
import styles from "./stock-count.module.css";

/**
 * Fixed widths of the lines table, in column order after the elastic Name
 * column: Counted, Cost each, Value, Sells for, delete. The Name column takes
 * what is left and never less than its floor; tests/unit/stock-count-screens
 * adds them up against the 984px box at a 1280px window.
 */
export const EDITOR_FIXED_WIDTHS = [104, 116, 116, 116, COLUMN.ACTION] as const;
export const READONLY_FIXED_WIDTHS = [104, 116, 116, 116] as const;
export const NAME_FLOOR = COLUMN.TEXT_MIN;

const PAGE_SIZE = 50;
const MAX_LISTED_PROBLEMS = 20;

type EditorLine = StockCountLineInput & { key: string };

export interface CountDetail {
  id: string;
  countNumber: string;
  asOf: string;
  status: string;
  memo: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  approvalRequestId: string | null;
  postedByName: string | null;
  postedAt: string | null;
  /** Figures frozen at posting (or at the request); null while a draft. */
  countedMinor: number | null;
  bookMinor: number | null;
}

export interface DetailProps {
  count: CountDetail;
  lines: StockCountLineInput[];
  /** The books on the count's as-of date, read when the page was drawn. */
  liveBookMinor: number;
  posting: PostingContext;
  companyName: string;
  currencyCode: string;
  decimals: number;
  canWrite: boolean;
  /** The company time zone, in which stamps are shown. */
  timeZone: string;
}

let keySeed = 0;
/** A row key that no other row, on this page or after a delete, ever shares. */
const withKey = (l: StockCountLineInput): EditorLine => ({ ...l, key: `l${keySeed++}` });

const blankLine = (): StockCountLineInput => ({ name: "", sku: null, quantity: 0, unitCostMinor: 0, sellsForMinor: null });

export default function StockCountDetailClient(props: DetailProps) {
  const locked = props.count.status !== "draft";
  return locked ? <LockedCount {...props} /> : <DraftCount {...props} />;
}

// ---------------------------------------------------------------------------
// A draft: edit, paste, save, adjust
// ---------------------------------------------------------------------------

function DraftCount({ count, lines, liveBookMinor, posting, currencyCode, decimals, canWrite }: DetailProps) {
  const { message, modal } = App.useApp();
  const [asOf, setAsOf] = useState(count.asOf);
  const [memo, setMemo] = useState(count.memo ?? "");
  const [rows, setRows] = useState<EditorLine[]>(() => lines.map(withKey));
  const [saved, setSaved] = useState(() => ({ asOf: count.asOf, memo: count.memo, lines }));
  const [book, setBook] = useState(liveBookMinor);
  const [bookBusy, setBookBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<CountProblem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<{ summary: string; problems: PasteProblem[] } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const latestBook = useRef(0);

  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const current = useMemo(() => ({ asOf, memo: memo.trim() === "" ? null : memo, lines: rows }), [asOf, memo, rows]);
  const dirty = isDirty(saved, current);
  useUnsavedGuard(dirty, modal);

  const counted = countedTotalMinor(rows);
  const difference = countDifferenceMinor(counted, book);
  const button = adjustButtonState({
    canAdjust: posting.canAdjust && canWrite,
    tracksItems: posting.tracksItems,
    dirty,
    differenceMinor: difference,
  });

  const patch = (key: string, change: Partial<StockCountLineInput>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const remove = (key: string) => setRows((all) => all.filter((r) => r.key !== key));

  function addLine() {
    setRows((all) => [...all, withKey(blankLine())]);
    // The new line is on the last page.
    setPage(Math.ceil((rows.length + 1) / pageSize));
  }

  async function changeDate(date: dayjs.Dayjs | null) {
    if (!date) return;
    const next = date.format("YYYY-MM-DD");
    setAsOf(next);
    await readBook(next);
  }

  async function readBook(next: string) {
    const run = ++latestBook.current;
    setBookBusy(true);
    try {
      const res = await bookValueAction(next);
      if (run !== latestBook.current) return;
      if (res.ok && res.data) setBook(res.data.bookMinor);
      else message.error(res.error ?? "The books could not be read for that date");
    } catch {
      if (run === latestBook.current) message.error("The books could not be read for that date");
    } finally {
      if (run === latestBook.current) setBookBusy(false);
    }
  }

  function readPaste() {
    const result = parseCountSheet(pasteText, decimals);
    const added = result.lines.map(withKey);
    if (added.length > 0) {
      setRows((all) => appendCountLines(all, added));
      setPage(Math.ceil((rows.length + added.length) / pageSize));
    }
    setPasteNote({ summary: pasteSummary(result), problems: result.problems });
    // What could not be read stays in the box, to be corrected and read again.
    setPasteText(result.problems.map((p) => p.text).join("\n"));
  }

  async function save() {
    const sentRows = rows;
    const draft = {
      asOf,
      memo: memo.trim() === "" ? null : memo.trim(),
      lines: rows.map((l) => ({
        name: l.name.trim(),
        sku: l.sku?.trim() ? l.sku.trim() : null,
        quantity: l.quantity,
        unitCostMinor: l.unitCostMinor,
        sellsForMinor: l.sellsForMinor,
      })),
    };
    const found = validateStockCount(draft);
    setProblems(found);
    setSaveError(null);
    if (found.length > 0) return;
    setSaving(true);
    try {
      const res = await saveStockCountAction({ id: count.id, ...draft });
      if (res.ok) {
        setSaved({ asOf: draft.asOf, memo: draft.memo, lines: draft.lines });
        setRows((all) => settleSavedRows(all, sentRows, draft.lines));
        message.success("Draft saved");
      } else {
        setSaveError(res.error ?? "The draft could not be saved");
      }
    } catch {
      setSaveError("The draft could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const amountProps = { controls: false, min: 0, className: styles.amount } as const;
  const base = (i: number) => (page - 1) * pageSize + i + 1;
  const pager = reportPagination(false, pageSize, setPageSize, PAGE_SIZE);

  return (
    <div>
      <div className={styles.controls}>
        <label className={styles.field}>
          As of
          <DatePicker
            aria-label="As of"
            value={dayjs(asOf)}
            allowClear={false}
            onChange={(d) => void changeDate(d)}
            disabled={saving}
          />
        </label>
        <label className={`${styles.field} ${styles.memo}`}>
          Memo
          <Input
            aria-label="Memo"
            value={memo}
            maxLength={500}
            placeholder="What this count covers"
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Save draft
        </Button>
      </div>

      {saveError ? <Alert className={styles.notice} type="error" showIcon title={saveError} /> : null}
      {problems.length > 0 ? (
        <Alert
          className={styles.notice}
          type="error"
          showIcon
          title="The count cannot be saved yet"
          description={
            <ul className={styles.problems}>
              {problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => (
                <li key={`${p.lineNumber ?? "sheet"}-${p.reason}`}>
                  {p.lineNumber === null ? p.reason : `Line ${p.lineNumber}: ${p.reason}`}
                </li>
              ))}
              {problems.length > MAX_LISTED_PROBLEMS ? <li>and {problems.length - MAX_LISTED_PROBLEMS} more</li> : null}
            </ul>
          }
        />
      ) : null}

      <StatRow
        items={[
          { label: "Lines", value: rows.length.toLocaleString("en-US") },
          { label: "Counted at cost", value: money(counted) },
          { label: "On the books", value: bookBusy ? "Reading…" : money(book) },
          { label: "Difference", value: signedAmountText(difference, money), danger: differenceTone(difference) === "shortage" },
        ]}
      />

      <ReportTable<EditorLine>
        rowKey="key"
        dataSource={rows}
        pagination={pager && { ...pager, current: page, onChange: (p, s) => { setPage(p); setPageSize(s); } }}
        emptyTitle="No lines yet"
        emptyDescription="Add a line, or paste a count sheet below."
        columns={[
          flexColumn<EditorLine>({
            title: "Name",
            key: "name",
            floor: NAME_FLOOR,
            render: (_: unknown, row, index) => (
              <div className={styles.nameCell}>
                <Input
                  size="small"
                  aria-label={`Name, line ${base(index)}`}
                  value={row.name}
                  maxLength={200}
                  placeholder="Name"
                  onChange={(e) => patch(row.key, { name: e.target.value })}
                />
                <Input
                  size="small"
                  className={styles.sku}
                  aria-label={`SKU, line ${base(index)}`}
                  value={row.sku ?? ""}
                  maxLength={100}
                  placeholder="SKU"
                  onChange={(e) => patch(row.key, { sku: e.target.value })}
                />
              </div>
            ),
          }),
          {
            title: "Counted",
            key: "quantity",
            width: EDITOR_FIXED_WIDTHS[0],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                aria-label={`Counted, line ${base(index)}`}
                value={row.quantity}
                onChange={(v) => patch(row.key, { quantity: roundQuantity(v) })}
              />
            ),
          },
          {
            title: "Cost each",
            key: "cost",
            width: EDITOR_FIXED_WIDTHS[1],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                precision={decimals}
                aria-label={`Cost each, line ${base(index)}`}
                value={fromMinor(row.unitCostMinor, decimals)}
                onChange={(v) => patch(row.key, { unitCostMinor: toMinor(Number(v ?? 0), decimals) })}
              />
            ),
          },
          {
            title: "Value",
            key: "value",
            width: EDITOR_FIXED_WIDTHS[2],
            align: "right",
            render: (_: unknown, row) => (
              <span className={styles.value}>{money(lineValueMinor(row.quantity, row.unitCostMinor))}</span>
            ),
          },
          {
            title: "Sells for",
            key: "sells",
            width: EDITOR_FIXED_WIDTHS[3],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                precision={decimals}
                aria-label={`Sells for, line ${base(index)}`}
                value={row.sellsForMinor === null ? null : fromMinor(row.sellsForMinor, decimals)}
                onChange={(v) => patch(row.key, { sellsForMinor: v === null ? null : toMinor(Number(v), decimals) })}
              />
            ),
          },
          {
            title: "",
            key: "delete",
            width: EDITOR_FIXED_WIDTHS[4],
            align: "center",
            render: (_: unknown, row, index) => (
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Delete line ${base(index)}`}
                onClick={() => remove(row.key)}
              />
            ),
          },
        ]}
        summary={() => (
          <SummaryRow>
            <SummaryCell index={0} colSpan={3} align="right">
              <strong>Counted at cost</strong>
            </SummaryCell>
            <SummaryCell index={1} align="right">
              <strong className={styles.value}>{money(counted)}</strong>
            </SummaryCell>
            <SummaryCell index={2} colSpan={2} />
          </SummaryRow>
        )}
      />

      <div style={{ marginTop: 12 }}>
        <Button icon={<PlusOutlined />} onClick={addLine}>
          Add a line
        </Button>
      </div>

      <section className={styles.paste} aria-label="Paste a count sheet">
        <h3 className={styles.pasteTitle}>Paste a count sheet</h3>
        <p className={styles.hint}>{PASTE_HINT}</p>
        <Input.TextArea
          aria-label="Count sheet"
          rows={5}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Gold chain 18in, 4, 120.00, 240.00\nSilver ring, 12, 18.50"}
        />
        <div className={styles.pasteActions}>
          <Button onClick={readPaste} disabled={pasteText.trim() === ""}>
            Read it
          </Button>
          {pasteNote && pasteNote.problems.length === 0 ? (
            <span className={styles.reason} role="status">
              {pasteNote.summary}
            </span>
          ) : null}
        </div>
        {pasteNote && pasteNote.problems.length > 0 ? (
          <Alert
            style={{ marginTop: 8 }}
            type="warning"
            showIcon
            title={pasteNote.summary}
            description={
              <>
                <ul className={styles.problems}>
                  {pasteNote.problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => (
                    <li key={p.lineNumber}>{pasteProblemText(p)}</li>
                  ))}
                  {pasteNote.problems.length > MAX_LISTED_PROBLEMS ? (
                    <li>and {pasteNote.problems.length - MAX_LISTED_PROBLEMS} more</li>
                  ) : null}
                </ul>
                The box now holds only the lines that could not be read; correct them and read again.
              </>
            }
          />
        ) : null}
      </section>

      {button.visible ? (
        <div className={styles.adjust}>
          <Button type="primary" disabled={button.disabled} onClick={() => setDialogOpen(true)}>
            {adjustButtonLabel(difference, asOf, money)}
          </Button>
          {button.reason ? <span className={styles.reason}>{button.reason}</span> : null}
          {posting.tracksItems ? <Link href="/items">{"Products & Services"}</Link> : null}
        </div>
      ) : null}

      <ReportFoot>{FOOTNOTE}</ReportFoot>

      {dialogOpen ? (
        <PostCountDialog
          open
          onClose={() => setDialogOpen(false)}
          countId={count.id}
          asOf={asOf}
          countedMinor={counted}
          bookMinor={book}
          differenceMinor={difference}
          posting={posting}
          money={money}
          onBooksChanged={() => void readBook(asOf)}
        />
      ) : null}
    </div>
  );
}

function roundQuantity(value: number | string | null): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const scale = 10 ** QUANTITY_DECIMALS;
  return Math.round(n * scale) / scale;
}

// ---------------------------------------------------------------------------
// A posted count, or one waiting for approval: read-only, printable
// ---------------------------------------------------------------------------

function LockedCount({ count, lines, liveBookMinor, companyName, currencyCode, decimals, timeZone }: DetailProps) {
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);

  useEffect(() => {
    const stop = watchReportPrinting();
    // Synchronous on purpose: the browser takes its print snapshot right after
    // beforeprint, so every line must be on the page by the time it returns.
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

  const posted = count.status === "posted";
  const counted = count.countedMinor ?? countedTotalMinor(lines);
  const book = count.bookMinor ?? liveBookMinor;
  const difference = countDifferenceMinor(counted, book);

  const sheet = useMemo(
    () =>
      stockCountSheet({
        companyName,
        currencyCode,
        decimals,
        countNumber: count.countNumber,
        asOf: count.asOf,
        status: count.status,
        memo: count.memo,
        lines,
        bookMinor: book,
      }),
    [companyName, currencyCode, decimals, count, lines, book],
  );

  const rows = useMemo(() => lines.map((l, i) => ({ ...l, key: String(i) })), [lines]);

  return (
    <div>
      {posted ? (
        <Alert
          className={styles.lockedBar}
          type="success"
          showIcon
          title={
            <>
              Posted{count.postedByName ? ` by ${count.postedByName}` : ""}
              {count.postedAt ? ` on ${dateInTimeZone(count.postedAt, timeZone)}` : ""}.{" "}
              {count.journalEntryId ? (
                <Link href={`/journal?entry=${count.journalEntryId}`}>
                  {count.journalEntryNumber ? `Open ${count.journalEntryNumber}` : "Open the entry"}
                </Link>
              ) : null}
            </>
          }
        />
      ) : (
        <Alert
          className={styles.lockedBar}
          type="info"
          showIcon
          title={
            <>
              Waiting for approval. It posts when a second person approves it, against the books as they stand then.{" "}
              {count.approvalRequestId ? (
                <Link href={`/approvals?focus=${count.approvalRequestId}`}>Open Approvals</Link>
              ) : (
                <Link href="/approvals">Open Approvals</Link>
              )}
            </>
          }
        />
      )}

      <FilterBar
        ariaLabel="Stock count exports"
        actions={
          <Space wrap>
            <Button onClick={() => downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>CSV</Button>
            <ReportExportButtons sheet={sheet} />
            <Button icon={<PrinterOutlined />} onClick={printReport}>
              Print
            </Button>
          </Space>
        }
      />

      <div className="report-print-area">
        <ReportPaper
          companyName={companyName}
          title="Stock Count"
          range={`${count.countNumber} · As of ${count.asOf} · ${stockCountStatusLabel(count.status)}`}
          basis={count.memo?.trim() ? count.memo.trim() : "Periodic count"}
          currencyCode={currencyCode}
        >
          <StatRow
            items={[
              { label: "Lines", value: lines.length.toLocaleString("en-US") },
              { label: "Counted at cost", value: money(counted) },
              { label: "On the books", value: money(book) },
              { label: posted ? "Adjusted by" : "Difference", value: signedAmountText(difference, money), danger: differenceTone(difference) === "shortage" },
            ]}
          />
          <ReportTable<(typeof rows)[number]>
            rowKey="key"
            dataSource={rows}
            pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
            emptyTitle="No lines"
            columns={[
              flexColumn<(typeof rows)[number]>({
                title: "Name",
                key: "name",
                floor: NAME_FLOOR,
                render: (_: unknown, row) => (
                  <>
                    <span title={row.name}>{row.name}</span>
                    {row.sku ? secondaryLine(row.sku) : null}
                  </>
                ),
              }),
              {
                title: "Counted",
                dataIndex: "quantity",
                width: READONLY_FIXED_WIDTHS[0],
                align: "right",
                render: (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: QUANTITY_DECIMALS }),
              },
              {
                title: "Cost each",
                dataIndex: "unitCostMinor",
                width: READONLY_FIXED_WIDTHS[1],
                align: "right",
                render: (m: number) => money(m),
              },
              {
                title: "Value",
                key: "value",
                width: READONLY_FIXED_WIDTHS[2],
                align: "right",
                render: (_: unknown, row) => money(lineValueMinor(row.quantity, row.unitCostMinor)),
              },
              {
                title: "Sells for",
                dataIndex: "sellsForMinor",
                width: READONLY_FIXED_WIDTHS[3],
                align: "right",
                render: (m: number | null) => (m === null ? "—" : money(m)),
              },
            ]}
            summary={() => (
              <SummaryRow>
                <SummaryCell index={0} colSpan={3} align="right">
                  <strong>Counted at cost</strong>
                </SummaryCell>
                <SummaryCell index={1} align="right">
                  <strong>{money(counted)}</strong>
                </SummaryCell>
                <SummaryCell index={2} />
              </SummaryRow>
            )}
          />
          <ReportFoot>{FOOTNOTE}</ReportFoot>
        </ReportPaper>
      </div>
    </div>
  );
}
