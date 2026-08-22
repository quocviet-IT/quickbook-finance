"use client";
import Link from "next/link";
import { Card } from "antd";
import StatusGlyph, { type GlyphName } from "./StatusGlyph";
import type {
  ControlStatus,
  SectionEnvelope,
  SurfaceControl,
} from "@/lib/domain/work-surface/types";
import { formatMoney } from "@/lib/format";
import styles from "./work-surface.module.css";
import { FreshnessNote, UnavailableNote } from "./DataStateNote";

/**
 * Whether a surface's own checks passed, failures first.
 *
 * Every row carries a mark, the word for its state, the condition it passes on,
 * and the figure it found. Colour agrees with all of that; it never has to carry
 * it alone, which is the rule the design document sets for status.
 *
 * **This draws checks; it never decides them.** Which checks a surface runs, and
 * what each one means, is the area's — this component could not name one if it
 * tried, and the boundary test makes sure of that.
 *
 * A client component, and measurably right to be one. Making it a Server
 * Component was tried and reverted: rendering antd from the server graph gives a
 * route its own copy of the antd client references instead of sharing the
 * app-wide chunk, and /accounting grew by 21KB gzip for a page that behaved
 * identically. The measurement is in the Phase 5 plan.
 */

const STATUS_PRESENTATION: Record<
  ControlStatus,
  { glyph: GlyphName; word: string; className: string }
> = {
  healthy: { glyph: "check", word: "Passed", className: styles.healthy },
  attention: { glyph: "warning", word: "Needs attention", className: styles.attention },
  blocked: { glyph: "cross", word: "Blocked", className: styles.blocked },
  unavailable: { glyph: "question", word: "Not evaluated", className: styles.unavailable },
};

/** Failures first: the rail is read top-down and the top is the alarm. */
const STATUS_ORDER: Record<ControlStatus, number> = {
  blocked: 0,
  attention: 1,
  unavailable: 2,
  healthy: 3,
};

export default function ControlPanel({
  controls,
  currencyCode,
  currencyDecimals,
  title = "Control health",
  unavailableFallback = "These checks could not be evaluated.",
  className,
}: {
  controls: SectionEnvelope<readonly SurfaceControl[]>;
  currencyCode: string;
  currencyDecimals: number;
  title?: string;
  unavailableFallback?: string;
  className?: string;
}) {
  const rows = [...(controls.data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <Card size="small" title={title} className={className}>
      {controls.dataState === "unavailable" || !controls.data ? (
        <UnavailableNote reason={controls.unavailableReason ?? unavailableFallback} />
      ) : (
        <div className={styles.controlList}>
          {rows.map((control) => {
            const presentation = STATUS_PRESENTATION[control.status];
            return (
              <div
                key={control.key}
                className={`${styles.controlRow} ${presentation.className}`}
              >
                <StatusGlyph name={presentation.glyph} className={styles.controlIcon} />
                <div className={styles.controlBody}>
                  <div className={styles.controlHead}>
                    <Link href={control.href} className={styles.controlName}>
                      {control.title}
                    </Link>
                    <span className={styles.controlDifference}>
                      {/* The word carries the state; the amount is evidence. */}
                      {presentation.word}
                      {control.differenceMinor !== undefined && control.differenceMinor !== 0
                        ? ` · ${formatMoney(control.differenceMinor, currencyCode, currencyDecimals)}`
                        : ""}
                    </span>
                  </div>
                  <span className={styles.controlDetail}>{control.detail}</span>
                  <span className={styles.controlPass}>
                    Passes when: {control.passCondition}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {controls.data ? (
        <FreshnessNote generatedAt={controls.generatedAt} dataState={controls.dataState} />
      ) : null}
    </Card>
  );
}
