"use client";
import { Button, Typography } from "antd";
import { CODE_ALL_LIMIT, type CodingSuggestionView } from "@/lib/domain/coding";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import type { BankReviewTableRow } from "./BankTransactionsTable";
import type { CodeAllRow } from "./CodeAllModal";
import styles from "./banking-coding.module.css";

/**
 * How many waiting lines in view already have an answer, and the button that
 * posts them — after a confirmation that lists every one.
 */
export default function CodingSuggestionsBar({
  rows,
  suggestions,
  canWrite,
  formatRowMoney,
  onCodeAll,
}: {
  rows: BankReviewTableRow[];
  suggestions: Map<string, CodingSuggestionView>;
  canWrite: boolean;
  formatRowMoney: (row: BankReviewTableRow) => string;
  onCodeAll: (rows: CodeAllRow[]) => void;
}) {
  const waiting = rows.filter((row) => row.transaction.status === "unmatched");
  const ready = waiting.filter((row) => suggestions.has(row.transaction.id));
  if (ready.length === 0) return null;
  const total = ready.reduce((sum, row) => sum + Math.abs(Number(row.transaction.amount_minor)), 0);
  const batch = ready.slice(0, CODE_ALL_LIMIT);

  return (
    <div className={styles.bar} role="status">
      <div className={styles.barText}>
        <Typography.Text strong>
          {ready.length} of {waiting.length} waiting line{waiting.length === 1 ? "" : "s"}{" "}
          {ready.length === 1 ? "has" : "have"} a suggestion, {formatMoney(total, USD_CURRENCY_CODE, 2)} in all.
        </Typography.Text>{" "}
        <span className={styles.hint}>
          {ready.length > CODE_ALL_LIMIT
            ? `Code all posts the first ${CODE_ALL_LIMIT}; ${ready.length - CODE_ALL_LIMIT} more wait for the next run.`
            : "Each one says where it is going and why."}
        </span>
      </div>
      {canWrite ? (
        <Button
          type="primary"
          onClick={() =>
            onCodeAll(
              batch.map((row) => {
                const suggestion = suggestions.get(row.transaction.id)!;
                return {
                  id: row.transaction.id,
                  accountId: suggestion.accountId,
                  txnDate: row.transaction.txn_date,
                  description: row.transaction.description,
                  amount: formatRowMoney(row),
                  accountLabel: suggestion.accountLabel,
                  why: suggestion.why,
                };
              }),
            )
          }
        >
          Code all {batch.length}
        </Button>
      ) : null}
    </div>
  );
}
