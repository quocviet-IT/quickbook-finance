"use client";
import { useState } from "react";
import { Button, Space, Tag, Typography, type TableColumnsType } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { ColumnHeaderCell, type ColumnHeaderCellProps } from "@/components/ui/ColumnHeaderCell";
import { useColumnDrag } from "@/components/ui/useColumnDrag";
import { useColumnResize } from "@/components/ui/useColumnResize";
import { COLUMN } from "@/lib/design/table-metrics";
import {
  BANK_BUDGET,
  BANK_COLUMN_KEYS,
  BANK_LAST_ELASTIC_KEY,
  BANK_MEASURED_WIDTHS,
  BANK_MIN_WIDTHS,
  BANK_WIDTH_STORAGE_KEY,
  BANK_WIDTH_STORAGE_KEY_V1,
  type BankColumnKey,
} from "./bank-transaction-columns";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import type { BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";
import CategoriseCell from "./CategoriseCell";
import DescriptionCell from "./DescriptionCell";
import MatchCell from "./MatchCell";
import DeleteRowAction from "./DeleteRowAction";
import type { AccountRow } from "@/lib/db/types";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { TOKENS } from "@/lib/design/tokens";
import { bankTransactionsPagination, BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE } from "./bank-transactions-pagination";
import type { BankTransactionDeleteEligibility } from "@/lib/domain/bank-transaction-delete";

export type BankReviewTableRow = BankReviewRow<BankTransactionRow, SuggestionView>;

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
  /** What each matched line was posted to, keyed by transaction; `others` names the rest of a split entry. */
  postings: Map<string, BankPostingRow & { others?: string[] }>;
  /** The chart's Uncategorized accounts, for telling a line that needs coding. */
  holdingIds: ReadonlySet<string>;
  /** Where each recoded line's money went, keyed by transaction. */
  recodes: Map<string, BankRecodeRow>;
  onCategorised: () => void;
  /** The coding suggestion for each waiting line, keyed by transaction. */
  codingSuggestions: Map<string, CodingSuggestionView>;
  /** The proposed split of each waiting loan payment, keyed by transaction. */
  loanSuggestions: Map<string, LoanSuggestionView>;
  /** Open the rule form for a line; the account is the one it is posted to or suggested for. */
  onCreateRule: (row: BankReviewTableRow, accountId: string | null) => void;
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
  holdingIds,
  recodes,
  onCategorised,
  codingSuggestions,
  loanSuggestions,
  onCreateRule,
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
  const { order: columnOrder, headerCellProps } = useColumnDrag<BankColumnKey>(BANK_COLUMN_KEYS);

  // RQ-01-REV: this reader's own column widths. Unlike the order above these
  // do survive a reload — a bookkeeper narrows Description because their
  // descriptions are always long, and making them do it again every morning
  // would be the same wasted effort the video was reporting.
  const { widths, resizeHandleProps, guardHeaderDrag } = useColumnResize<BankColumnKey>(
    BANK_MEASURED_WIDTHS,
    BANK_WIDTH_STORAGE_KEY,
    BANK_MIN_WIDTHS,
    // Without this the drag has no ceiling and would put the horizontal
    // scrollbar back — which is what the reader reported after the August
    // release shipped the gesture itself.
    BANK_BUDGET,
    BANK_WIDTH_STORAGE_KEY_V1,
  );

  const dataColumns: TableColumnsType<BankReviewTableRow> = [
    {
      title: "Date",
      key: "date",
      dataIndex: ["transaction", "txn_date"],
      width: widths.date ?? COLUMN.DATE,
    },
    {
      // The elastic column, and the only one that never takes a width:
      // something has to absorb the remainder or the row total stops being the
      // box, and the column holding text somebody typed is the one that should
      // grow. Its second line carries the account source and the reference,
      // which used to be columns of their own.
      ...flexColumn<BankReviewTableRow>({
        title: "Description",
        key: "description",
        render: (_value: unknown, row: BankReviewTableRow) => <DescriptionCell row={row} />,
      }),
    },
    {
      title: "Amount",
      key: "amount",
      width: widths.amount ?? COLUMN.MONEY,
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
      width: widths.category ?? COLUMN.PICKER,
      render: (_value: unknown, row: BankReviewTableRow) => {
        const posting = postings.get(row.transaction.id) ?? null;
        const suggestion = codingSuggestions.get(row.transaction.id) ?? null;
        return (
          <CategoriseCell
            transactionId={row.transaction.id}
            status={row.transaction.status}
            accounts={postableAccounts}
            posting={posting}
            canWrite={canWrite}
            onChanged={onCategorised}
            suggestion={suggestion}
            loan={loanSuggestions.get(row.transaction.id) ?? null}
            // A rule is filled with where the money belongs: the recode's account,
            // never Uncategorized, which a rule may not target.
            onCreateRule={() =>
              onCreateRule(
                row,
                recodes.get(row.transaction.id)?.account_id ??
                  (posting && !holdingIds.has(posting.account_id) ? posting.account_id : null) ??
                  suggestion?.accountId ??
                  null,
              )
            }
            holding={Boolean(posting && holdingIds.has(posting.account_id))}
            recode={recodes.get(row.transaction.id) ?? null}
          />
        );
      },
    },
    {
      // Measured, at exactly the floor its controls need: a tag, a line of
      // text and up to three buttons. Left elastic in the first cut of this,
      // and the screenshot showed the mistake — 340px spent rendering the word
      // "Matched" while the description beside it was cut mid-reference. It
      // leads with the status tag that used to be a column of its own, out
      // past the right-hand edge.
      title: "Match",
      key: "match",
      width: widths.match ?? COLUMN.RICH_MIN,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <MatchCell
          row={row}
          canWrite={canWrite}
          busy={busy}
          statusTag={
            <Space size={4}>
              <Tag color={TXN_STATUS[row.transaction.status].color}>
                {TXN_STATUS[row.transaction.status].text}
              </Tag>
              {row.transaction.pending ? <Tag>Pending</Tag> : null}
            </Space>
          }
          onSettle={onSettle}
          onApprove={onApprove}
          onReject={onReject}
        />
      ),
    },
  ];

  // RQ-01: never draggable, never a drop target. These two are built apart
  // from dataColumns and appended after the reorder is applied, so there is
  // no key of theirs in BANK_COLUMN_KEYS for a reader to drag a data column
  // onto, and no onHeaderCell on either that would make them draggable
  // themselves — see ColumnHeaderCell's module comment for what that
  // omission actually enforces.
  //
  // No longer `fixed: "right"`. rc-table only pins a column while horizontal
  // scrolling is on (Table.js, horizonScroll), and under `fit` there is none:
  // a pinned column would have nothing to stick to and would still carry the
  // sticky background of one.
  const pinnedColumns: TableColumnsType<BankReviewTableRow> = [
    ...(canWrite
      ? [
          {
            title: "",
            key: "delete",
            width: COLUMN.ACTION,
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
            width: COLUMN.ACTION,
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
      //
      // Except on the last elastic column, which gets no handle at all: it is
      // the column paying for every other column's width, and a width of its
      // own would leave nothing absorbing the remainder.
      const header: ColumnHeaderCellProps = {
        ...guardHeaderDrag(headerCellProps(key)),
        ...(key === BANK_LAST_ELASTIC_KEY ? null : resizeHandleProps(key)),
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
        // only for the five data columns) ever looks or behaves differently.
        components={{ header: { cell: ColumnHeaderCell } }}
        // The widths above are binding because DataTable puts every fitted
        // table in `table-layout: fixed` and passes no `scroll.x` at all —
        // see components/ui/DataTable.tsx. This table used to hand rc-table a
        // total width, which is precisely how dragging a column produced the
        // sideways scrolling the reader reported.
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
