"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Input, Modal, Progress, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { CloseStepStatus } from "@/lib/domain/accounting-dashboard/close-checklist";
import type { CloseReadiness } from "@/lib/services/accounting-dashboard";
import type { SectionEnvelope } from "@/lib/domain/accounting-dashboard/types";
import { closePeriodAction, reopenPeriodAction } from "@/app/(app)/accounting/actions";
import styles from "./accounting-dashboard.module.css";
import { FreshnessNote, UnavailableNote } from "./DataStateNote";

/**
 * Whether a period can be signed off, and what is stopping it.
 *
 * Nothing on this panel can be ticked. There is no control that marks a step
 * done, because a step is done when the ledger says so — the design document
 * asks for that as a prohibition and it is kept structurally: no mutation for
 * step state exists anywhere in the stack.
 *
 * The two buttons that do write are Close and Reopen, and both go straight to
 * the RPCs that already refuse a non-admin, require a reason, and will not
 * close over a variance without a written explanation. None of those rules is
 * re-stated here; this screen is one more caller of them.
 */

const STATUS_ICON: Record<CloseStepStatus, React.ReactNode> = {
  complete: <CheckCircleFilled style={{ color: "var(--ob-intent-success)" }} />,
  outstanding: <CloseCircleFilled style={{ color: "var(--ob-intent-danger)" }} />,
  "not-applicable": <MinusCircleOutlined style={{ color: "var(--ob-text-muted)" }} />,
  unavailable: <QuestionCircleOutlined style={{ color: "var(--ob-intent-warning)" }} />,
};

const STATUS_LABEL: Record<CloseStepStatus, string> = {
  complete: "Done",
  outstanding: "Outstanding",
  "not-applicable": "Not applicable",
  unavailable: "Could not check",
};

export default function ClosePanel({
  close,
  canClose,
  owners,
}: {
  close: SectionEnvelope<CloseReadiness | null>;
  /** Only an admin may close or reopen; the database enforces it either way. */
  canClose: boolean;
  /** Who holds each blocking step, by the step's work key. */
  owners: Record<string, string>;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [action, setAction] = useState<"close" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (close.dataState === "unavailable" || close.data === null) {
    return (
      <Card size="small" title="Period close">
        {close.dataState === "unavailable" ? (
          <UnavailableNote
            reason={
              close.unavailableReason ??
              "The close checklist could not be worked out, so nothing here says this period is ready."
            }
          />
        ) : (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            No accounting period covers today and none is open past its end date. Generate the
            periods for this fiscal year in{" "}
            <Link href="/settings/periods">Accounting periods</Link> and the checklist will have
            something to measure.
          </Typography.Paragraph>
        )}
      </Card>
    );
  }

  const { period, steps, progress, gateBlockers, history, medianDaysToClose } = close.data;
  const blockers = steps.filter((s) => s.status === "outstanding" && s.blocksClose);
  const isClosed = period.status === "closed";

  async function submit() {
    if (!action) return;
    setBusy(true);
    const result =
      action === "close"
        ? await closePeriodAction({
            periodId: period.id,
            reason,
            varianceNote: varianceNote.trim() || null,
          })
        : await reopenPeriodAction({ periodId: period.id, reason });
    setBusy(false);
    if (result.ok) {
      message.success(action === "close" ? "Period closed" : "Period reopened");
      setAction(null);
      setReason("");
      setVarianceNote("");
      router.refresh();
    } else {
      message.error(result.error ?? "The period could not be changed");
    }
  }

  return (
    <Card
      size="small"
      title={`Closing ${period.label}`}
      extra={
        <span className={styles.closeExtra}>
          <Typography.Text type="secondary">covers through {period.periodEnd}</Typography.Text>
          <Tag color={isClosed ? "green" : "blue"}>{period.status}</Tag>
        </span>
      }
    >
      {/* Progress, and every number it is made of. A bar on its own invites the
          reader to trust it; the counts beside it let them check it. */}
      <div className={styles.closeProgress}>
        <Progress
          type="circle"
          size={72}
          percent={progress.percent ?? 0}
          format={() => (progress.percent === null ? "—" : `${progress.percent}%`)}
          status={progress.outstanding > 0 ? "exception" : "success"}
        />
        <div className={styles.closeProgressFacts}>
          <Typography.Text strong>
            {progress.complete} of {progress.applicable} steps done
          </Typography.Text>
          {progress.notApplicable > 0 ? (
            <Typography.Text type="secondary">
              {progress.notApplicable} do not apply to this company
            </Typography.Text>
          ) : null}
          {progress.unavailable > 0 ? (
            // Counted apart from both sides on purpose. A step nobody could
            // check is not progress and is not a failure, and folding it into
            // either would make the percentage a claim it cannot support.
            <Typography.Text type="warning">
              {progress.unavailable} could not be checked, so this figure is not the whole story
            </Typography.Text>
          ) : null}
          {medianDaysToClose !== null ? (
            <Typography.Text type="secondary">
              The last {history.length} closes took {medianDaysToClose} days after month end,
              typically
            </Typography.Text>
          ) : null}
        </div>
      </div>

      {gateBlockers ? (
        <Alert
          className={styles.closeGate}
          type="error"
          showIcon
          message="The database will refuse this close"
          description={
            <>
              {gateBlockers}
              <div style={{ marginTop: 6 }}>
                It can still be closed with a written explanation of the difference, which is
                stored on the period and audited.
              </div>
            </>
          }
        />
      ) : null}

      <ul className={styles.closeSteps}>
        {steps.map((step) => (
          <li key={step.key} className={styles.closeStep} data-status={step.status}>
            <span className={styles.closeStepIcon} aria-hidden="true">
              {STATUS_ICON[step.status]}
            </span>
            <div className={styles.closeStepBody}>
              <div className={styles.closeStepHead}>
                <Tooltip title={step.passCondition}>
                  <Link href={step.href}>{step.title}</Link>
                </Tooltip>
                {step.blocksClose && step.status === "outstanding" ? (
                  <Tag color="red">Blocks the close</Tag>
                ) : null}
                {step.workKey && owners[step.workKey] ? (
                  <Tag>{owners[step.workKey]}</Tag>
                ) : null}
                <span className={styles.closeStepStatus}>{STATUS_LABEL[step.status]}</span>
              </div>
              <Typography.Text type="secondary">{step.evidence}</Typography.Text>
            </div>
          </li>
        ))}
      </ul>

      {history.length > 0 ? (
        <div className={styles.closeHistory}>
          <Typography.Text type="secondary">How long the last closes took: </Typography.Text>
          {history.map((entry) => (
            <Tag key={entry.periodEnd}>
              {entry.periodLabel}: {entry.daysToClose}d
            </Tag>
          ))}
        </div>
      ) : null}

      <div className={styles.closeActions}>
        {canClose ? (
          isClosed ? (
            <Button onClick={() => setAction("reopen")}>Reopen this period</Button>
          ) : (
            <Button
              type="primary"
              danger={blockers.length > 0}
              onClick={() => setAction("close")}
            >
              {blockers.length > 0 ? "Close anyway…" : "Close this period"}
            </Button>
          )
        ) : (
          <Typography.Text type="secondary">
            Only an admin can close or reopen a period.
          </Typography.Text>
        )}
        <Link href="/settings/periods">
          <Button type="link">All periods</Button>
        </Link>
      </div>

      <Modal
        open={action !== null}
        title={action === "reopen" ? `Reopen ${period.label}` : `Close ${period.label}`}
        okText={action === "reopen" ? "Reopen" : "Close the period"}
        okButtonProps={{ disabled: reason.trim().length === 0, loading: busy }}
        onOk={() => void submit()}
        onCancel={() => setAction(null)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {action === "reopen"
            ? "Reopening lets entries be posted into this period again. The reason is recorded against the period."
            : "Closing stops anything being posted into this period. The reason is recorded against the period."}
        </Typography.Paragraph>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why — recorded on the period and in the audit log"
        />
        {action === "close" && gateBlockers ? (
          <>
            <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 4 }}>
              {gateBlockers}
            </Typography.Paragraph>
            <Input.TextArea
              rows={2}
              value={varianceNote}
              onChange={(e) => setVarianceNote(e.target.value)}
              placeholder="Explain the difference — without this the database will refuse"
            />
          </>
        ) : null}
      </Modal>

      <FreshnessNote generatedAt={close.generatedAt} dataState={close.dataState} />
    </Card>
  );
}
