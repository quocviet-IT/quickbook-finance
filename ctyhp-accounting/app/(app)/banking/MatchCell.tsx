"use client";
import { Button, Space, Tag, Typography } from "antd";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";

type Row = BankReviewRow<BankTransactionRow, SuggestionView>;

export interface MatchCellProps {
  row: Row;
  canWrite: boolean;
  /** The suggestion currently being approved or rejected, if any. */
  busy: string | null;
  onSettle: (row: Row) => void;
  onApprove: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
}

/**
 * What a bank line looks like it is, and the decision about it, in the same
 * cell the line is read from. This used to be a separate tab.
 *
 * Lifted out of `BankTransactionsTable` when that file crossed the 400-line
 * ceiling `tests/unit/bank-categories-ui-contract.test.ts` holds it to. It
 * sits beside `CategoriseCell` for the same reason that one does: a cell that
 * makes its own decisions is easier to read on its own than buried in a
 * column array. Every behaviour here arrived unchanged.
 */
export default function MatchCell({
  row,
  canWrite,
  busy,
  onSettle,
  onApprove,
  onReject,
}: MatchCellProps) {
  // Offered on any line still awaiting review, with or without a suggestion:
  // a suggestion says "this is already in the books", and settling says "it is
  // not, and it pays this invoice".
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
          <Button size="small" type="primary" loading={busy === match.id} onClick={() => onApprove(match.id)}>
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
}
