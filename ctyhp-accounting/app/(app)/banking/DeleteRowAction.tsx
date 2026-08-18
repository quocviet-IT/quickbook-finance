"use client";
import { DeleteOutlined } from "@ant-design/icons";
import IconActionButton from "@/components/ui/IconActionButton";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow } from "@/lib/db/types";
import type { BankPostingRow, SuggestionView } from "@/lib/services/banking";
import {
  evaluateBankTransactionDelete,
  type BankTransactionDeleteEligibility,
} from "@/lib/domain/bank-transaction-delete";

type Row = BankReviewRow<BankTransactionRow, SuggestionView>;

export interface DeleteRowActionProps {
  row: Row;
  /** What this line was posted to, if anything — the fact that decides
   *  whether deleting it also has to void a journal entry. */
  posting: BankPostingRow | undefined;
  onDelete: (row: Row, eligibility: BankTransactionDeleteEligibility) => void;
}

/**
 * The Delete control on one bank line.
 *
 * Every row carries it (Correction to RQ-06): a company where every line is
 * already categorised must still see a way to remove one, not a button that
 * only ever appears on the status nobody has left. Where the books genuinely
 * refuse, the control stays visible but disabled with the real reason in its
 * tooltip — never hidden, and never a generic failure after the click. Every
 * case lives in lib/domain/bank-transaction-delete.ts; this component only
 * asks and renders the answer.
 *
 * Lifted out of `BankTransactionsTable` when that file crossed the 400-line
 * ceiling `tests/unit/bank-categories-ui-contract.test.ts` holds it to.
 */
export default function DeleteRowAction({ row, posting, onDelete }: DeleteRowActionProps) {
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
}
