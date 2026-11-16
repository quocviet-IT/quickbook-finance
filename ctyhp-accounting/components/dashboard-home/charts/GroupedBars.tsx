"use client";
import type { HomeMonth } from "@/lib/domain/dashboard-home/types";
import styles from "../dashboard-home.module.css";
import { ChartTip, FiguresTable, useChartHover, useChartWidth } from "./ChartFrame";
import { bands, barSlots, barSpan, labelFitsAcross, px, valueAxis, yScale } from "./geometry";
import { monthName } from "./labels";

const LEFT = 48;
const RIGHT = 4;
const TOP = 10;
/** Room under the bars for the month names. */
const BOTTOM = 24;

export interface BarSeries {
  key: string;
  label: string;
  values: readonly number[];
  /** A `var(--ob-…)` color. */
  color: string;
}

/**
 * Bars by month, one or two to a month: income and expenses on Profit and
 * loss, sales alone on Sales. Bars stand on zero and can go below it. A month
 * not entered yet is a dashed "Not posted" block, never a zero. With `toDate`
 * the last month is marked as month to date and drawn lighter.
 */
export default function GroupedBars({
  months,
  series,
  money,
  compact,
  height = 190,
  toDate = false,
  label,
  caption,
}: {
  months: readonly HomeMonth[];
  series: readonly BarSeries[];
  money: (minor: number) => string;
  compact: (minor: number) => string;
  height?: number;
  toDate?: boolean;
  /** What the drawing shows, with its main figures, for a screen reader. */
  label: string;
  /** The hidden table's caption. */
  caption: string;
}) {
  const { ref, width } = useChartWidth(360);
  const { box, hover, track, leave } = useChartHover();
  const count = months.length;
  const bottom = height - BOTTOM;
  const { step, centers } = bands(count, LEFT, width - RIGHT);
  const shown = series.flatMap((one) => one.values.filter((_, i) => months[i]?.posted));
  const ticks = valueAxis(shown, 3, true);
  const y = yScale(ticks, TOP, bottom);
  const single = series.length === 1;
  const widest = single ? 28 : 11;
  const last = count - 1;

  const tipLines = (index: number): string[] | null => {
    const month = months[index];
    if (!month) return null;
    const name = monthName(month, index === last);
    if (!month.posted) return [name, "Not posted"];
    return [name, ...series.map((one) => `${one.label} ${money(one.values[index])}`)];
  };

  return (
    <div ref={box} className={styles.chartBox}>
      <div ref={ref} className={styles.chartMeasure}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={label}
          onMouseLeave={leave}
        >
          {hover ? (
            <rect
              className={styles.hoverBand}
              x={px(centers[hover.index] - step / 2)}
              y={TOP - 6}
              width={px(step)}
              height={bottom - TOP + 6}
              rx={4}
            />
          ) : null}
          {ticks.map((tick, i) => (
            <g key={i}>
              <line className={tick === 0 ? styles.baseLine : styles.gridLine} x1={LEFT} x2={width - RIGHT} y1={px(y(tick))} y2={px(y(tick))} />
              <text className={styles.chartText} x={LEFT - 6} y={px(y(tick)) + 4} textAnchor="end">
                {compact(tick)}
              </text>
            </g>
          ))}
          {months.map((month, i) => {
            const center = centers[i];
            if (!month.posted) {
              const blockWidth = px(Math.min(step * 0.8, 44));
              const middle = px(TOP + (bottom - TOP) / 2);
              const across = labelFitsAcross("Not posted", blockWidth);
              return (
                <g key={month.key}>
                  <rect
                    className={styles.notPosted}
                    x={px(center - blockWidth / 2)}
                    y={TOP}
                    width={blockWidth}
                    height={bottom - TOP}
                    rx={4}
                    strokeDasharray="4 4"
                  />
                  <text
                    className={styles.chartText}
                    x={px(center)}
                    y={middle + 4}
                    textAnchor="middle"
                    transform={across ? undefined : `rotate(-90 ${px(center)} ${middle})`}
                  >
                    Not posted
                  </text>
                </g>
              );
            }
            const slots = barSlots(center, step, series.length, widest);
            return (
              <g key={month.key} opacity={toDate && i === last ? 0.55 : undefined}>
                {series.map((one, k) => {
                  const span = barSpan(one.values[i], y);
                  return (
                    <rect
                      key={one.key}
                      x={slots[k].x}
                      y={span.y}
                      width={slots[k].width}
                      height={span.height}
                      rx={2}
                      style={{ fill: one.color }}
                    />
                  );
                })}
              </g>
            );
          })}
          {months.map((month, i) => (
            <text key={`label-${month.key}`} className={styles.chartText} x={px(centers[i])} y={height - 6} textAnchor="middle">
              {toDate && i === last ? `${month.label} MTD` : month.label}
            </text>
          ))}
          {months.map((month, i) => (
            <rect
              key={`hit-${month.key}`}
              className={styles.hit}
              x={px(centers[i] - step / 2)}
              y={0}
              width={px(step)}
              height={height}
              onMouseMove={track(i)}
              onClick={track(i)}
            />
          ))}
        </svg>
      </div>
      <ChartTip hover={hover} lines={hover ? tipLines(hover.index) : null} />
      <FiguresTable
        caption={caption}
        head={["Month", ...series.map((one) => one.label)]}
        rows={months.map((month, i) => [
          monthName(month, i === last),
          ...series.map((one) => (month.posted ? money(one.values[i]) : "Not posted")),
        ])}
      />
    </div>
  );
}
