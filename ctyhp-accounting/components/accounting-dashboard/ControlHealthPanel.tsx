"use client";
import Link from "next/link";
import { Card } from "antd";
import StatusGlyph, { type GlyphName } from "@/components/work-surface/StatusGlyph";
import type {
  AccountingControl,
  ControlStatus,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import { formatMoney } from "@/lib/format";
import styles from "./accounting-dashboard.module.css";
import { FreshnessNote, UnavailableNote } from "./DataStateNote";

/**
 * Whether the books are safe, in the order an accountant asks.
 *
 * Every row carries an icon, the word for its state, the condition it passes
 * on, and the figure it found. Colour agrees with all of that; it never has to
 * carry it alone, which is the rule the design document sets for status.
 *
 * A client component, and measurably right to be one. Making it a Server
 * Component was tried and reverted: rendering antd from the server graph gives
 * this route its own copy of the antd client references instead of sharing the
 * app-wide chunk, and /accounting grew by 21KB gzip for a page that behaves
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

export default function ControlHealthPanel({
  controls,
  currencyCode,
  currencyDecimals,
}: {
  controls: SectionEnvelope<AccountingControl[]>;
  currencyCode: string;
  currencyDecimals: number;
}) {
  const rows = [...(controls.data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <Card size="small" title="Control health" className="accounting-control-health">
      {controls.dataState === "unavailable" || !controls.data ? (
        <UnavailableNote
          reason={
            controls.unavailableReason ?? "The accounting controls could not be evaluated."
          }
        />
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
