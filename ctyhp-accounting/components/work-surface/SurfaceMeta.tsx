"use client";
import { useMemo } from "react";
import { Tag } from "antd";
import { ClockCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { formatTime } from "@/lib/format";
import { summarizeSections, type SurfaceSectionState } from "@/lib/domain/work-surface/surface-meta";
import styles from "./work-surface.module.css";

/**
 * The overview's facts, as part of its subtitle: "As of 10/17/2026 · USD ·
 * Eastern Time · Computed at 5:34 AM", then a tag for any section that could
 * not be computed or is old enough to stop trusting.
 *
 * Passed to PageHeader's `meta`, so it sits under the description instead of
 * in a box of its own. The time is printed here once; the sections below say
 * it again only when they have gone stale.
 */
export default function SurfaceMeta({
  facts,
  sections,
  timeZone,
}: {
  facts: readonly string[];
  sections: readonly SurfaceSectionState[];
  /** The company's zone, so the server and the browser print the same time. */
  timeZone: string;
}) {
  // Freshness is judged against the reader's clock: a page left open for an
  // hour is stale although nothing about the payload changed.
  const { stale, unavailable, generatedAt } = useMemo(() => summarizeSections(sections), [sections]);
  const line = generatedAt ? [...facts, `Computed at ${formatTime(generatedAt, timeZone)}`] : [...facts];
  return (
    <div className={styles.meta}>
      <span>
        {/* Each fact keeps its words together, so a phone breaks the line
            between facts and never inside "9:27 PM". */}
        {line.map((part, index) => (
          <span key={part}>
            {index > 0 ? " · " : null}
            <span className={styles.metaPart}>{part}</span>
          </span>
        ))}
      </span>
      {unavailable.length > 0 ? (
        <Tag color="warning" icon={<WarningOutlined />}>
          {unavailable.join(", ")} unavailable
        </Tag>
      ) : null}
      {stale.length > 0 ? <Tag icon={<ClockCircleOutlined />}>{stale.join(", ")} stale</Tag> : null}
    </div>
  );
}
