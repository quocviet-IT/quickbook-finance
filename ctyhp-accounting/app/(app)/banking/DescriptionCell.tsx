"use client";
import { Tooltip, Typography } from "antd";
import type { CSSProperties } from "react";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";

type Row = BankReviewRow<BankTransactionRow, SuggestionView>;

/**
 * One line, cut to the column, with an ellipsis to say it was cut.
 *
 * Ant Design's own `ellipsis` column option cannot do this here. It puts the
 * truncation CSS on the cell, and this cell holds two stacked lines rather
 * than one string — so the rules land on a flex container and its children
 * clip mid-word with no ellipsis at all, which reads as data that simply
 * stops. Applying them to each line is what actually produces the "…".
 */
const ONE_LINE: CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/**
 * What the bank called this line, and where the line came from.
 *
 * This is the column RQ-01-REV is really about: it holds the longest text on
 * the screen, it is the one the reviewer pointed at, and until this change it
 * had no width at all — so it grew to fit the longest wire description in the
 * account and pushed Amount and Category off the side. It is now a resizable
 * column like any other, and whatever does not fit is cut with the whole text
 * one hover away, the same treatment every other free-text column in this app
 * gets (components/ui/long-text-column.tsx).
 */
export default function DescriptionCell({ row }: { row: Row }) {
  const origin = row.transaction.category
    ? row.transaction.category.replaceAll("_", " ")
    : row.transaction.source === "bank_feed"
      ? "Direct bank feed"
      : "File upload";

  return (
    <Tooltip title={row.transaction.description} placement="topLeft" styles={{ root: { maxWidth: 640 } }}>
      <div style={{ minWidth: 0 }}>
        <span style={ONE_LINE}>{row.transaction.description}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12, ...ONE_LINE }}>
          {origin}
        </Typography.Text>
      </div>
    </Tooltip>
  );
}
