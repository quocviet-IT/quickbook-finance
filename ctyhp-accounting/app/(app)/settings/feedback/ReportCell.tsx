"use client";
import { Space, Typography } from "antd";
import { secondaryLine } from "@/components/ui/columns";
import { summarizePageContext } from "@/lib/domain/feedback";
import type { FeedbackImprovementView, FeedbackReportView } from "@/lib/services/feedback";

/**
 * What a reporter said, and where they said it from.
 *
 * Its own file because the triage screen is held to 400 lines by
 * tests/unit/feedback-my-reports.test.ts, and because this is the one cell on
 * that table anybody actually reads: it earns being editable on its own.
 *
 * Where the report came from and who filed it used to be columns of their own,
 * 410px between them on a table already 823px past the edge of the screen —
 * the very complaint being triaged in it. They are context for the words
 * above, so they read underneath them.
 */
export function reportProvenance(row: FeedbackReportView, pagePurpose?: string | null): string {
  return [summarizePageContext(row.page), pagePurpose, row.reporter?.email ?? "no email"]
    .filter(Boolean)
    .join(" · ");
}

export default function ReportCell({
  row,
  entry,
}: {
  row: FeedbackReportView;
  /** The ranked improvement for this report, when one has been filed. */
  entry: FeedbackImprovementView | undefined;
}) {
  const under = secondaryLine(reportProvenance(row, entry?.pagePurpose));

  // A suggestion reads as an argument: the difficulty first, then what was
  // asked for. The free-text note is background and comes last.
  if (entry?.currentDifficulty || entry?.desiredOutcome) {
    return (
      <Space direction="vertical" size={2} style={{ width: "100%", minWidth: 0 }}>
        {entry.currentDifficulty ? (
          <Typography.Paragraph
            style={{ marginBottom: 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
          >
            <Typography.Text type="secondary">Today: </Typography.Text>
            {entry.currentDifficulty}
          </Typography.Paragraph>
        ) : null}
        {entry.desiredOutcome ? (
          <Typography.Paragraph
            style={{ marginBottom: 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
          >
            <Typography.Text type="secondary">Wants: </Typography.Text>
            {entry.desiredOutcome}
          </Typography.Paragraph>
        ) : null}
        {row.description ? (
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
          >
            {row.description}
          </Typography.Paragraph>
        ) : null}
        {under}
      </Space>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      {row.description ? (
        <Typography.Paragraph
          style={{ marginBottom: 0 }}
          ellipsis={{ rows: 3, expandable: true, symbol: "more" }}
        >
          {row.description}
        </Typography.Paragraph>
      ) : (
        <Typography.Text type="secondary">No description</Typography.Text>
      )}
      {under}
    </div>
  );
}
