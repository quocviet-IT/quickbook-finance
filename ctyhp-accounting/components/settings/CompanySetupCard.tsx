"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Button, Card, Tag, Typography } from "antd";
import { CheckCircleFilled, ExclamationCircleFilled, QuestionCircleFilled } from "@ant-design/icons";
import {
  setupProgress,
  setupProgressLabel,
  type SetupStep,
  type SetupStepState,
} from "@/lib/domain/company-setup";
import styles from "./company-setup.module.css";

const STATE_ICON: Record<SetupStepState, ReactNode> = {
  done: <CheckCircleFilled style={{ color: "var(--ob-intent-success)" }} />,
  todo: <ExclamationCircleFilled style={{ color: "var(--ob-intent-warning)" }} />,
  check: <QuestionCircleFilled style={{ color: "var(--ob-intent-info)" }} />,
};

const STATE_LABEL: Record<SetupStepState, string> = {
  done: "Done",
  todo: "To do",
  check: "Check",
};

/**
 * What these books still need before work starts in them (3.00). Each step is
 * read from the books, so it ticks itself off once the work is done.
 *
 * `onEdit` opens the settings form on this same page, for the one step whose
 * screen is this one; the others link to theirs.
 */
export default function CompanySetupCard({ steps, onEdit }: { steps: SetupStep[]; onEdit?: () => void }) {
  const progress = setupProgress(steps);
  return (
    // The progress sits in the body, not beside the title: on a phone the title
    // and a tag beside it did not both fit, and the title was cut short.
    <Card title="Setting up this company">
      <div className={styles.lede}>
        <Tag color={progress.complete ? "green" : "orange"}>{setupProgressLabel(progress)}</Tag>
        <Typography.Text type="secondary">
          What a new set of books needs before work starts in it. Each step is read from the books, so it ticks
          itself off when the work is done.
        </Typography.Text>
      </div>
      <ul className={styles.steps}>
        {steps.map((step) => (
          <li key={step.key} className={styles.step} data-state={step.state}>
            <span className={styles.icon} aria-hidden="true">
              {STATE_ICON[step.state]}
            </span>
            <div className={styles.body}>
              <div className={styles.head}>
                <span>{step.title}</span>
                <span className={styles.state}>{STATE_LABEL[step.state]}</span>
              </div>
              <Typography.Text type="secondary">{step.detail}</Typography.Text>
              {step.state !== "done" ? (
                step.key === "details" ? (
                  onEdit ? (
                    <Button type="link" size="small" className={styles.action} style={{ paddingInline: 0 }} onClick={onEdit}>
                      {step.action}
                    </Button>
                  ) : null
                ) : (
                  <Link href={step.href} className={styles.action}>
                    {step.action}
                  </Link>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
