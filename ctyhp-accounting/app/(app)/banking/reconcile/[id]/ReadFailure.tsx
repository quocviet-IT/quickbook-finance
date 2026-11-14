"use client";
import { Alert, Button } from "antd";

/**
 * The four things the reconciliation screen reads, each on its own (3.0.33).
 *
 * A read that failed used to say "Failed" in a toast that was gone in three
 * seconds, and leave its part of the screen looking empty — a statement with
 * no lines, an account with nothing to tick — which reads as the books saying
 * so. Now the part that could not be read says so where it sits, keeps
 * whatever it had already read, and offers to read it again.
 */
export type WorkspacePart = "figures" | "statement" | "lines" | "history" | "plan";

/** What the reader sees as the notice's title. */
export const FAILURE_TITLE: Record<WorkspacePart, string> = {
  figures: "The reconciliation's figures could not be read",
  statement: "The statement lines could not be read",
  lines: "The book lines could not be read",
  history: "The account's earlier reconciliations could not be read",
  plan: "What Add all would add could not be worked out",
};

/** What the reader is missing while the part is not read, when nothing of it is on screen. */
const WITHOUT: Record<WorkspacePart, string> = {
  figures: "The balances, the difference and Complete wait for them.",
  statement: "Nothing can be paired with the statement until they are.",
  lines: "Nothing can be ticked until they are.",
  history: "Whether earlier history can be brought forward is not known until they are.",
  plan: "The statement lines the books do not have are marked below; Add all comes back once this is worked out.",
};

export default function ReadFailure({
  part,
  reason,
  shown,
  retrying,
  onRetry,
}: {
  part: WorkspacePart;
  /** The server's own words for why. */
  reason: string;
  /** Something read earlier is still on screen. */
  shown: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Alert
      type="error"
      showIcon
      role="alert"
      title={FAILURE_TITLE[part]}
      description={`${reason} ${shown ? "What is shown was read earlier and may be out of date." : WITHOUT[part]}`}
      action={
        <Button size="small" loading={retrying} onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}
