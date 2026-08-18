"use client";
import { useState } from "react";
import { Button, Space, Tag, Typography, type TableColumnsType } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { longTextColumn } from "@/components/ui/long-text-column";
import { ColumnHeaderCell, type ColumnHeaderCellProps } from "@/components/ui/ColumnHeaderCell";
import { useColumnDrag } from "@/components/ui/useColumnDrag";
import { useColumnResize } from "@/components/ui/useColumnResize";
import { totalColumnWidth } from "@/lib/domain/column-width";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";
import CategoriseCell from "./CategoriseCell";
import DescriptionCell from "./DescriptionCell";
import MatchCell from "./MatchCell";
import DeleteRowAction from "./DeleteRowAction";
import type { AccountRow } from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import { TOKENS } from "@/lib/design/tokens";
import { bankTransactionsPagination, BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE } from "./bank-transactions-pagination";
import type { BankTransactionDeleteEligibility } from "@/lib/domain/bank-transaction-delete";

export type BankReviewTableRow = BankReviewRow<BankTransactionRow, SuggestionView>;

/**
 * RQ-01: the reorderable data columns, in the order they ship today.
 *
 * Deliberately just these eight — never "delete" or "attachments". Those two
 * are built separately below, always `fixed: "right"`, and are never given
 * to `useColumnDrag`, so there is no key here a reader could drag them to:
 * the drag mechanism only ever sees the columns in this list, and only ever
 * reorders among them.
 */
const DATA_COLUMN_KEYS = [
  "date",
  "description",
  "account",
  "reference",
  "amount",
  "category",
  "match",
  "status",
] as const;

type BankColumnKey = (typeof DATA_COLUMN_KEYS)[number];

/**
 * RQ-01-REV: the width each column starts at, and the only place those
 * numbers live now.
 *
 * Seven of them are the literals this table has always used. `description` is
 * the new one: it never had a width, which is precisely why the reviewer had
 * to scroll. A column with no width in a table asked to be as wide as its
 * contents grows to fit the longest wire description in the account and
 * pushes Amount, Category and Status off the side of the screen — the
 * complaint in the follow-up video, word for word: "you have to scroll again,
 * wherever in left or right."
 */
const DEFAULT_COLUMN_WIDTHS: Record<BankColumnKey, number> = {
  date: 115,
  description: 320,
  account: 200,
  reference: 135,
  amount: 140,
  category: 190,
  match: 300,
  status: 130,
};

/**
 * Where this reader's own widths are kept. Namespaced by screen so a second
 * resizable table cannot silently inherit this one's columns.
 */
const COLUMN_WIDTH_STORAGE_KEY = "onebook.bank-transactions.column-widths";

/**
 * Each pinned action column, in pixels. They are declared `width: 56` below
 * and are not resizable — but they still occupy the row, so the table's own
 * scroll width has to count them or the last data column ends up underneath
 * the Delete button.
 */
const PINNED_COLUMN_WIDTH = 56;

const TXN_STATUS: Record<BankTxnStatus, { text: string; color: string }> = {
  unmatched: { text: "For review", color: "orange" },
  matched: { text: "Matched", color: "green" },
  ignored: { text: "Excluded", color: "default" },
};

export interface BankTransactionsTableProps {
  rows: BankReviewTableRow[];
  loading: boolean;
  initialFocusId: string | null;
  canWrite: boolean;
  canReadDocuments: boolean;
  /** The suggestion currently being approved or rejected, if any. */
  busy: string | null;
  formatRowMoney: (row: BankReviewTableRow) => string;
  /** Every account money may be posted to, for the Category search. */
  postableAccounts: AccountRow[];
  /** What each matched line was posted to, keyed by transaction. */
  postings: Map<string, BankPostingRow>;
  onCategorised: () => void;
  onSettle: (row: BankReviewTableRow) => void;
  onApprove: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  onAttachments: (row: BankReviewTableRow) => void;
  /** Remove a line that should never have been imported — every row carries
   *  the control now (Correction to RQ-06); `eligibility` says whether this
   *  click deletes outright, voids an entry first, or was blocked before it
   *  could fire (a blocked row's control is disabled, so this only ever
   *  arrives as "delete_only" or "void_then_delete" in practice). */
  onDelete: (row: BankReviewTableRow, eligibility: BankTransactionDeleteEligibility) => void;
  /** RQ-03: already pruned against `rows` by the caller, so this is always a
   *  subset of what is currently in the filtered result — never a row that
   *  has dropped out of it. */
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** RQ-05: opens the batch Category/Account dialog for the current selection. */
  onBatchAssign: (kind: "category" | "account") => void;
}

/**
 * The bank lines, and the decision about each one.
 *
 * Lifted out of `BankingClient` — which was 1042 lines — so this table can be
 * read, and changed, without holding the whole screen in your head. Every
 * behaviour here arrived unchanged from that file.
 */
export default function BankTransactionsTable({
  rows,
  loading,
  initialFocusId,
  canWrite,
  canReadDocuments,
  busy,
  formatRowMoney,
  postableAccounts,
  postings,
  onCategorised,
  onSettle,
  onApprove,
  onReject,
  onAttachments,
  onDelete,
  selectedIds,
  onSelectionChange,
  onBatchAssign,
}: BankTransactionsTableProps) {
  // Held here, not written as a literal on the pagination prop: see
  // bank-transactions-pagination.ts for why a literal `pageSize` pins Ant
  // Design's table back to that number on every render (RQ-04).
  const [pageSize, setPageSize] = useState<number>(BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE);

  // RQ-01: the current session's column order. Starts as DATA_COLUMN_KEYS,
  // exactly the shipped order, and lives only in this component's state —
  // section 8 of the change request settled that a reorder does not survive
  // a reload or a fresh login.
  const { order: columnOrder, headerCellProps } = useColumnDrag<BankColumnKey>(DATA_COLUMN_KEYS);

  // RQ-01-REV: this reader's own column widths. Unlike the order above these
  // do survive a reload — a bookkeeper narrows Description because their
  // descriptions are always long, and making them do it again every morning
  // would be the same wasted effort the video was reporting.
  const { widths, resizeHandleProps, guardHeaderDrag } = useColumnResize<BankColumnKey>(
    DEFAULT_COLUMN_WIDTHS,
    COLUMN_WIDTH_STORAGE_KEY,
  );

  const dataColumns: TableColumnsType<BankReviewTableRow> = [
    { title: "Date", key: "date", dataIndex: ["transaction", "txn_date"], width: widths.date },
    {
      title: "Description",
      key: "description",
      width: widths.description,
      render: (_value: unknown, row: BankReviewTableRow) => <DescriptionCell row={row} />,
    },
    {
      title: "Account source",
      key: "account",
      width: widths.account,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Typography.Text type="secondary">{row.accountName}</Typography.Text>
      ),
    },
    {
      title: "Reference",
      key: "reference",
      dataIndex: ["transaction", "reference"],
      // A reference is whatever the bank's file put there, and some of them
      // are a 36-character payment id. Under a fixed layout that wrapped over
      // three lines and made every row in the table taller; the shared helper
      // cuts it to the column and keeps the whole value on hover, which is
      // what every other free-text column here already does.
      ...longTextColumn(widths.reference),
    },
    {
      title: "Amount",
      key: "amount",
      width: widths.amount,
      align: "right",
      render: (_value: unknown, row: BankReviewTableRow) => (
        <span style={{ color: row.transaction.amount_minor < 0 ? TOKENS.money.negative : TOKENS.money.positive }}>
          {formatRowMoney(row)}
        </span>
      ),
    },
    {
      // After the money, before the accounting: what this line is *to you*,
      // which is a different question from which document it settles.
      title: "Category",
      key: "category",
      width: widths.category,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <CategoriseCell
          transactionId={row.transaction.id}
          status={row.transaction.status}
          accounts={postableAccounts}
          posting={postings.get(row.transaction.id) ?? null}
          canWrite={canWrite}
          onChanged={onCategorised}
        />
      ),
    },
    {
      // What the line looks like it is, and the decision, in the same place the
      // line is read. This used to be a separate tab.
      title: "Match",
      key: "match",
      width: widths.match,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <MatchCell
          row={row}
          canWrite={canWrite}
          busy={busy}
          onSettle={onSettle}
          onApprove={onApprove}
          onReject={onReject}
        />
      ),
    },
    {
      title: "Status",
      key: "status",
      width: widths.status,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Space size={4}>
          <Tag color={TXN_STATUS[row.transaction.status].color}>
            {TXN_STATUS[row.transaction.status].text}
          </Tag>
          {row.transaction.pending ? <Tag>Pending</Tag> : null}
        </Space>
      ),
    },
  ];

  // RQ-01: never draggable, never a drop target. These two are built apart
  // from dataColumns and appended after the reorder is applied, so there is
  // no key of theirs in DATA_COLUMN_KEYS for a reader to drag a data column
  // onto, and no onHeaderCell on either that would make them draggable
  // themselves — see ColumnHeaderCell's module comment for what that
  // omission actually enforces.
  const pinnedColumns: TableColumnsType<BankReviewTableRow> = [
    ...(canWrite
      ? [
          {
            title: "",
            key: "delete",
            width: 56,
            fixed: "right" as const,
            render: (_value: unknown, row: BankReviewTableRow) => (
              <DeleteRowAction
                row={row}
                posting={postings.get(row.transaction.id)}
                onDelete={onDelete}
              />
            ),
          } as TableColumnsType<BankReviewTableRow>[number],
        ]
      : []),
    ...(canReadDocuments
      ? [
          {
            title: "",
            key: "attachments",
            width: 56,
            fixed: "right" as const,
            render: (_value: unknown, row: BankReviewTableRow) => (
              <IconActionButton
                label="View bank transaction attachments"
                icon={<PaperClipOutlined />}
                onClick={() => onAttachments(row)}
              />
            ),
          } as TableColumnsType<BankReviewTableRow>[number],
        ]
      : []),
  ];

  const dataColumnsByKey = new Map(dataColumns.map((column) => [column.key as BankColumnKey, column]));

  // The session's drag order applied to the actual column definitions. A key
  // in columnOrder with no matching entry can only happen if DATA_COLUMN_KEYS
  // and this table's own columns ever drift apart — skipped rather than
  // crashed, the same "a stale key does nothing" choice reorderColumns makes.
  const columns: TableColumnsType<BankReviewTableRow> = [
    ...columnOrder.flatMap((key) => {
      const column = dataColumnsByKey.get(key);
      if (!column) return [];
      // Both interactions on one heading, the way a spreadsheet has them:
      // the heading itself moves the column, its right edge resizes it.
      // `guardHeaderDrag` is the line between them — it swallows the reorder
      // that a press on the resize handle would otherwise start.
      const header: ColumnHeaderCellProps = {
        ...guardHeaderDrag(headerCellProps(key)),
        ...resizeHandleProps(key),
      };
      return [{ ...column, onHeaderCell: () => header }];
    }),
    ...pinnedColumns,
  ];

  return (
    <>
      {/* RQ-03 batch-action bar: only ever shown once a row is checked, and
          only offered to a reader who can write — matching every other
          write-gated control on this table. */}
      {canWrite && selectedIds.length > 0 ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Typography.Text strong>{selectedIds.length} selected</Typography.Text>
          <Button size="small" onClick={() => onBatchAssign("category")}>
            Set Category
          </Button>
          <Button size="small" onClick={() => onBatchAssign("account")}>
            Set Account
          </Button>
        </Space>
      ) : null}
      <DataTable
        rowKey={(row: BankReviewTableRow) => row.transaction.id}
        columns={columns}
        // RQ-01 and RQ-01-REV: the only header-cell override on this table.
        // Every header cell renders through this — including the row-selection
        // checkbox and the pinned action columns above — but only a column
        // whose own onHeaderCell supplies drag or resize props (set above,
        // only for the eight data columns) ever looks or behaves differently.
        components={{ header: { cell: ColumnHeaderCell } }}
        // RQ-01-REV, and the reason resizing works at all here. rc-table falls
        // back to `table-layout: auto` when a table has a pinned column and
        // asks for `scroll.x: "max-content"` — which this one did, through
        // DataTable's default (see @rc-component/table/es/Table.js, the
        // mergedTableLayout memo). Under `auto` a declared column width is a
        // hint the browser may overrule, so narrowing Description would have
        // changed a number and left the screen exactly as it was. Naming the
        // layout and handing over a real total width makes the widths binding,
        // which is what makes the horizontal scrollbar actually get shorter.
        tableLayout="fixed"
        scroll={{ x: totalColumnWidth(widths, pinnedColumns.length * PINNED_COLUMN_WIDTH) }}
        // Holds the table to exactly the widths above rather than letting it
        // stretch to fill a wide screen — on a stretched table the spare room
        // is shared across every column, so narrowing one widens the rest.
        // Invisible here at the default widths, which already overflow a
        // laptop; it matters on a large monitor. See app/globals.css.
        className="accounting-table--exact-widths"
        dataSource={rows}
        rowClassName={(row: BankReviewTableRow) =>
          row.transaction.id === initialFocusId ? "accounting-data-row--focused" : ""
        }
        rowSelection={
          canWrite
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => onSelectionChange(keys as string[]),
              }
            : undefined
        }
        pagination={bankTransactionsPagination(pageSize, setPageSize)}
        sticky
        loading={loading}
        emptyTitle="No bank transactions"
        emptyDescription="Synchronize a bank feed or import a statement to start the review workflow."
      />
    </>
  );
}
