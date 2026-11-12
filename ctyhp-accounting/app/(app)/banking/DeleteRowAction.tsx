"use client";
import { DeleteOutlined } from "@ant-design/icons";
import IconActionButton from "@/components/ui/IconActionButton";
import type { BankReviewRow } from "@/lib/domain/bank-review-rows";
import type { BankTransactionRow } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";
import { DELETE_DIALOG } from "@/lib/domain/bank-transaction-delete";

type Row = BankReviewRow<BankTransactionRow, SuggestionView>;

export interface DeleteRowActionProps {
  row: Row;
  /** The role holds Delete bank lines (3.0.23, Settings › Permissions). */
  canDelete: boolean;
  onDelete: (row: Row) => void;
}

/**
 * The Delete control on one bank line.
 *
 * 3.0.23: pressing it opens the dialog, which asks the database how the line
 * stands and either deletes it (unposted, unmatched, unreconciled) or says why
 * not and offers the way out: Void for a line posted here, Unmatch for one
 * matched to an entry posted elsewhere, the reconciliation for a reconciled
 * one. So a refusal always comes with what to do instead, never as a greyed
 * control whose reason hides in a tooltip. Only a role without the permission
 * finds the control disabled, and the tooltip says who can change that.
 *
 * Lifted out of `BankTransactionsTable` when that file crossed the 400-line
 * ceiling `tests/unit/bank-categories-ui-contract.test.ts` holds it to.
 */
export default function DeleteRowAction({ row, canDelete, onDelete }: DeleteRowActionProps) {
  return (
    <IconActionButton
      danger
      label={canDelete ? "Delete this bank transaction" : DELETE_DIALOG.noPermission}
      icon={<DeleteOutlined />}
      disabled={!canDelete}
      onClick={() => onDelete(row)}
    />
  );
}
