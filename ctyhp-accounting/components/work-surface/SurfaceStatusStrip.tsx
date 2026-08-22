"use client";
import { Tag } from "antd";
import { ClockCircleOutlined, WarningOutlined } from "@ant-design/icons";
import styles from "./work-surface.module.css";
import { timeOnly } from "./DataStateNote";

/**
 * Where the reader is, and how far the page can be trusted, in one strip.
 *
 * **Deliberately not cards.** The screens this replaces spent their first
 * viewport on four metric boxes, two of which nobody can act on, and pushed the
 * actual work below the fold. Metadata gets a strip; the work gets the space.
 *
 * `lead` is whatever a surface most needs stated first — the period on
 * Accounting, nothing at all on Banking. `facts` are the plain ones every
 * surface has. The two tags at the end are the ones that matter most and are
 * therefore never optional: which sections could not be computed, and which are
 * old enough to stop trusting.
 */
export default function SurfaceStatusStrip({
  lead,
  facts,
  generatedAt,
  staleSections,
  unavailableSections,
  label = "Status",
}: {
  lead?: React.ReactNode;
  facts: readonly string[];
  generatedAt: string;
  staleSections: readonly string[];
  unavailableSections: readonly string[];
  label?: string;
}) {
  return (
    <section className={styles.strip} aria-label={label}>
      {lead ? <div className={styles.stripLead}>{lead}</div> : null}
      <div className={styles.stripFacts}>
        {facts.map((fact) => (
          <span key={fact} className={styles.stripFact}>
            {fact}
          </span>
        ))}
        <span className={styles.stripFact}>
          <ClockCircleOutlined aria-hidden="true" /> {timeOnly(generatedAt)}
        </span>
        {unavailableSections.length > 0 ? (
          <Tag color="warning" icon={<WarningOutlined />}>
            {unavailableSections.join(", ")} unavailable
          </Tag>
        ) : null}
        {staleSections.length > 0 ? (
          <Tag icon={<ClockCircleOutlined />}>{staleSections.join(", ")} stale</Tag>
        ) : null}
      </div>
    </section>
  );
}
