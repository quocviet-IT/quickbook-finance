"use client";
import { formatDate } from "@/lib/format";
import { useState } from "react";
import { Alert, Checkbox, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  NOT_A_TRANSACTION,
  OTHER_SOURCE_NOTE,
  previewLineLabel,
  type StatementDialogView,
} from "@/lib/domain/statement-import-dialog";
import { OTHER_SOURCE_WARNING } from "@/lib/domain/statement-repeats";
import { IMPORT_PREVIEW_WIDTH as PW } from "./import-preview-columns";
import styles from "./import-statement.module.css";

/**
 * The lines the import dialog read (2.04), before anything is sent:
 *
 * - the sets of identical lines, and how many of each are already in Bank
 *   Transactions and how many will be imported;
 * - the lines already in Bank Transactions from another source — the books, a
 *   bank feed or another file — skipped unless ticked back;
 * - every line, each with its own Not a transaction tick: a ticked line is
 *   struck through, left out of the count and not sent.
 *
 * On a phone the table keeps its measured widths and scrolls inside its own box
 * (import-statement.module.css, IMPORT_PREVIEW_MIN_WIDTH).
 */
interface Props {
  /** Every line read, in file order. */
  lines: readonly StatementLine[];
  /** Indexes ticked Not a transaction. */
  aside: ReadonlySet<number>;
  onAside: (index: number, aside: boolean) => void;
  view: Pick<StatementDialogView, "repeats" | "otherSource" | "skip">;
  /** Ticks a line already here from another source back, to import it as well, or skips it again. */
  onBack: (index: number, back: boolean) => void;
  money: (minor: number) => string;
}

interface PreviewRow {
  index: number;
  line: StatementLine;
}

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const PREVIEW_DEFAULT_PAGE_SIZE = 10;

export default function StatementLinesPreview({ lines, aside, onAside, view, onBack, money }: Props) {
  const [pageSize, setPageSize] = useState<number>(PREVIEW_DEFAULT_PAGE_SIZE);
  const skipped = new Set(view.skip);
  const rows: PreviewRow[] = lines.map((line, index) => ({ index, line }));
  /** A cell of a line ticked Not a transaction is struck through. */
  const cell = (row: PreviewRow, text: string) => (
    <Typography.Text delete={aside.has(row.index)} type={aside.has(row.index) ? "secondary" : undefined}>
      {text}
    </Typography.Text>
  );
  return (
    <div className={styles.panel}>
      {view.repeats.length ? (
        <ul className={styles.list}>
          {view.repeats.map((group) => (
            <li key={group.indexes.join(",")}>
              <Typography.Text type="secondary">{group.text}</Typography.Text>
            </li>
          ))}
        </ul>
      ) : null}
      {view.otherSource.length ? (
        <Alert
          type="info"
          showIcon
          title={OTHER_SOURCE_WARNING}
          description={
            <div>
              <Typography.Text type="secondary">{OTHER_SOURCE_NOTE}</Typography.Text>
              <ul className={styles.list} style={{ listStyle: "none", paddingLeft: 0 }}>
                {view.otherSource.map((other) => (
                  <li key={other.index}>
                    <Checkbox checked={!skipped.has(other.index)} onChange={(e) => onBack(other.index, e.target.checked)}>
                      {previewLineLabel(lines[other.index], money)}
                    </Checkbox>
                  </li>
                ))}
              </ul>
            </div>
          }
        />
      ) : null}
      <div className={styles.preview}>
        <DataTable<PreviewRow>
          rowKey={(row) => String(row.index)}
          size="small"
          dataSource={rows}
          pagination={
            rows.length > PREVIEW_DEFAULT_PAGE_SIZE
              ? clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PREVIEW_DEFAULT_PAGE_SIZE))
              : false
          }
          columns={[
            {
              title: NOT_A_TRANSACTION,
              key: "aside",
              width: PW.aside,
              render: (_, row) => (
                <Checkbox
                  aria-label={`${NOT_A_TRANSACTION}: ${previewLineLabel(row.line, money)}`}
                  checked={aside.has(row.index)}
                  onChange={(e) => onAside(row.index, e.target.checked)}
                />
              ),
            },
            { title: "Date", key: "date", width: PW.date, render: (_, row) => cell(row, formatDate(row.line.txn_date)) },
            { title: "Description", key: "description", render: (_, row) => cell(row, row.line.description || "—") },
            {
              title: "Amount",
              key: "amount",
              width: PW.amount,
              align: "right",
              render: (_, row) => cell(row, money(row.line.amount_minor)),
            },
          ]}
        />
      </div>
    </div>
  );
}
