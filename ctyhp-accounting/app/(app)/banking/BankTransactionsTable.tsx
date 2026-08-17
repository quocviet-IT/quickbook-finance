"use client";
import { useState } from "react";
import { Button, Space, Tag, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, PaperClipOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { DraggableHeaderCell } from "@/components/ui/DraggableHeaderCell";
import { useColumnDrag } from "@/components/ui/useColumnDrag";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";
import CategoriseCell from "./CategoriseCell";
import type { AccountRow } from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import { TOKENS } from "@/lib/design/tokens";
import { bankTransactionsPagination, BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE } from "./bank-transactions-pagination";
import {
  evaluateBankTransactionDelete,
  type BankTransactionDeleteEligibility,
} from "@/lib/domain/bank-transaction-delete";

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

  const dataColumns: TableColumnsType<BankReviewTableRow> = [
    { title: "Date", key: "date", dataIndex: ["transaction", "txn_date"], width: 115 },
    {
      title: "Description",
      key: "description",
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Space direction="vertical" size={0}>
          <span>{row.transaction.description}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.transaction.category
              ? row.transaction.category.replaceAll("_", " ")
              : row.transaction.source === "bank_feed"
                ? "Direct bank feed"
                : "File upload"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Account source",
      key: "account",
      width: 200,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Typography.Text type="secondary">{row.accountName}</Typography.Text>
      ),
    },
    {
      title: "Reference",
      key: "reference",
      dataIndex: ["transaction", "reference"],
      width: 135,
      render: (reference: string | null) => reference ?? "—",
    },
    {
      title: "Amount",
      key: "amount",
      width: 140,
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
      width: 190,
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
      width: 300,
      render: (_value: unknown, row: BankReviewTableRow) => {
        // Offered on any line still awaiting review, with or without a
        // suggestion: a suggestion says "this is already in the books", and
        // settling says "it is not, and it pays this invoice".
        const settleButton =
          canWrite && row.transaction.status === "unmatched" ? (
            <Button size="small" onClick={() => onSettle(row)}>
              {row.transaction.amount_minor > 0 ? "Settle invoice" : "Settle bill"}
            </Button>
          ) : null;

        if (!row.suggestion) {
          return (
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">
                {row.transaction.status === "matched" ? "Matched" : "No suggestion"}
              </Typography.Text>
              {settleButton}
            </Space>
          );
        }
        const match = row.suggestion;
        return (
          <Space direction="vertical" size={2}>
            <Space size={6} wrap>
              <Tag color="blue">{match.target_number ?? "Ledger entry"}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {match.target_type.replaceAll("_", " ")} · {Math.round(match.confidence * 100)}%
              </Typography.Text>
            </Space>
            {match.target_description ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {match.target_description}
              </Typography.Text>
            ) : null}
            {canWrite ? (
              <Space size={4} wrap>
                <Button
                  size="small"
                  type="primary"
                  loading={busy === match.id}
                  onClick={() => onApprove(match.id)}
                >
                  Approve
                </Button>
                <Button size="small" loading={busy === match.id} onClick={() => onReject(match.id)}>
                  Reject
                </Button>
                {settleButton}
              </Space>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      width: 130,
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
  // themselves — see DraggableHeaderCell's module comment for what that
  // omission actually enforces.
  const pinnedColumns: TableColumnsType<BankReviewTableRow> = [
    ...(canWrite
      ? [
          {
            title: "",
            key: "delete",
            width: 56,
            fixed: "right" as const,
            render: (_value: unknown, row: BankReviewTableRow) => {
              // Every row carries the control now (Correction to RQ-06): a
              // company where every line is already categorised must still
              // see a way to remove one, not a button that only ever
              // appears on the status nobody has left. Where the books
              // genuinely refuse, the control stays visible but disabled,
              // with the real reason in its tooltip — see
              // lib/domain/bank-transaction-delete.ts for every case.
              const posting = postings.get(row.transaction.id);
              const eligibility = evaluateBankTransactionDelete({
                status: row.transaction.status,
                transactionBatchId: row.transaction.transaction_batch_id,
                posting: posting
                  ? {
                      ownEntry: posting.own_entry,
                      entryNumber: posting.entry_number,
                      sourceType: posting.source_type,
                    }
                  : null,
                hasOpenSuggestion: row.suggestion !== null,
              });
              const blocked = eligibility.kind === "blocked";
              return (
                <IconActionButton
                  danger
                  label={blocked ? eligibility.reason : "Delete this bank transaction"}
                  icon={<DeleteOutlined />}
                  disabled={blocked}
                  onClick={() => onDelete(row, eligibility)}
                />
              );
            },
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
      return column ? [{ ...column, onHeaderCell: () => headerCellProps(key) }] : [];
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
        // RQ-01: the only header-cell override on this table. Every header
        // cell renders through this — including the row-selection checkbox
        // and the pinned action columns above — but only a column whose own
        // onHeaderCell supplies drag props (set above, only for the eight
        // data columns) ever looks or behaves differently.
        components={{ header: { cell: DraggableHeaderCell } }}
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
