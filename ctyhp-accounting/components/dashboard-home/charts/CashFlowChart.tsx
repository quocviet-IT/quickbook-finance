"use client";
import { tokenVar } from "@/lib/design/tokens";
import type { HomeMonth } from "@/lib/domain/dashboard-home/types";
import { formatDate } from "@/lib/format";
import styles from "../dashboard-home.module.css";
import { ChartTip, FiguresTable, useChartHover, useChartWidth } from "./ChartFrame";
import {
  bands,
  barSlots,
  labelFitsAcross,
  labelStride,
  labelWidth,
  placeEdgeLabel,
  px,
  runs,
  smoothPath,
  valueAxis,
  yScale,
  type Point,
} from "./geometry";
import { monthDayLabel, monthName } from "./labels";

/*
 * The drawing, top to bottom: the balance line in its area (with room above
 * for the projected figure), a gap, the money in and out bars, the month
 * names. Every number is in CSS pixels; the width is the card's.
 */
const HEIGHT = 276;
const LEFT = 52;
const RIGHT = 8;
const TOP = 24;
const AREA = 128;
const GAP = 30;
const BARS = 64;
const AREA_BOTTOM = TOP + AREA;
const BASE = AREA_BOTTOM + GAP + BARS;
/** The room after the last month for the projected point, as a share of a month's width. */
const PROJECTION_ROOM = 0.9;
/** The least room between the last month's name and the projected day under it. */
const DAY_LABEL_GAP = 4;

const INCOME = tokenVar("series.income");
const SECONDARY = tokenVar("series.secondary");

export interface CashProjectionPoint {
  /** The day the projection is for. */
  date: string;
  valueMinor: number;
}

/**
 * Cash flow: the month-end cash balance as a line over a faint fill, a dashed
 * step to the projected balance, and each month's money in and out as bars
 * under it. A month not entered yet is a dashed "Not posted" block.
 *
 * Six or twelve months (3.0.41). When the months' names would touch (twelve
 * on a phone or a narrow card), every other one is written, counting back
 * from the month to date; each month keeps its tooltip and its row in the
 * table. The projected day is written under its point, kept inside the
 * chart, and left out when it would touch the last month's name: the
 * sentence under the chart says it.
 */
export default function CashFlowChart({
  months,
  balance,
  inflow,
  outflow,
  projection,
  money,
  compact,
}: {
  months: readonly HomeMonth[];
  balance: readonly number[];
  inflow: readonly number[];
  outflow: readonly number[];
  projection: CashProjectionPoint | null;
  money: (minor: number) => string;
  compact: (minor: number) => string;
}) {
  const { ref, width } = useChartWidth(640);
  const { box, hover, track, leave } = useChartHover();
  const count = months.length;
  const posted = months.map((month) => month.posted);
  const lastPosted = posted[count - 1] === true;
  const projected = projection && lastPosted ? projection : null;
  const { step, centers } = bands(count, LEFT, width - RIGHT, projected ? PROJECTION_ROOM : 0);

  const shownBalances = balance.filter((_, i) => posted[i]);
  const ticks = valueAxis(projected ? [...shownBalances, projected.valueMinor] : shownBalances, 3, false);
  const y = yScale(ticks, TOP, AREA_BOTTOM);
  const points = balance.map((value, i): Point | null => (posted[i] ? [px(centers[i]), px(y(value))] : null));
  const lines = runs(points);
  const lastPoint = points[count - 1];

  const barMax = Math.max(0, ...inflow.filter((_, i) => posted[i]), ...outflow.filter((_, i) => posted[i]));
  const barHeight = (value: number) => (barMax > 0 ? px((Math.max(0, value) / barMax) * BARS) : 0);

  const projectionX = px(LEFT + step * (count + PROJECTION_ROOM / 2));
  const projectionY = projected ? px(y(projected.valueMinor)) : 0;
  const projectionLabel = projected ? compact(projected.valueMinor) : "";
  // Kept inside the drawing: a long figure near the right edge is right-aligned to it.
  const projectionLabelAtEdge = projectionX + labelWidth(projectionLabel) / 2 > width - 2;

  // Every month named when the names fit; otherwise every other one (or fewer), the last always.
  const stride = labelStride(step, months.map((month) => month.label));
  const named = (index: number) => (count - 1 - index) % stride === 0;
  const lastName = months[count - 1]?.label ?? "";
  const dayLabel = projected ? monthDayLabel(projected.date) : "";
  const dayPlace = projected
    ? placeEdgeLabel(projectionX, dayLabel, width - 2, centers[count - 1] + labelWidth(lastName) / 2 + DAY_LABEL_GAP)
    : null;

  const tipLines = (index: number): string[] | null => {
    if (index === count && projected) return [`Projected for ${formatDate(projected.date)}`, money(projected.valueMinor)];
    const month = months[index];
    if (!month) return null;
    const name = monthName(month, index === count - 1);
    if (!month.posted) return [name, "Not posted"];
    return [name, `Cash ${money(balance[index])}`, `Money in ${money(inflow[index])}`, `Money out ${money(outflow[index])}`];
  };

  const today = lastPosted ? money(balance[count - 1]) : null;
  const label = [
    `Cash balance at each month end, and money in and out by month, for the last ${count} months.`,
    today ? `Cash today ${today}.` : null,
    projected ? `Projected ${money(projected.valueMinor)} on ${formatDate(projected.date)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={box} className={styles.chartBox}>
      <div ref={ref} className={styles.chartMeasure}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label={label}
          onMouseLeave={leave}
        >
          {hover && hover.index < count ? (
            <rect
              className={styles.hoverBand}
              x={px(centers[hover.index] - step / 2)}
              y={TOP - 8}
              width={px(step)}
              height={BASE - TOP + 8}
              rx={4}
            />
          ) : null}

          {ticks.map((tick, i) => (
            <g key={i}>
              <line className={styles.gridLine} x1={LEFT} x2={width - RIGHT} y1={px(y(tick))} y2={px(y(tick))} />
              <text className={styles.chartText} x={LEFT - 8} y={px(y(tick)) + 4} textAnchor="end">
                {compact(tick)}
              </text>
            </g>
          ))}

          {lines.map((line, i) =>
            line.length > 1 ? (
              <path
                key={`fill-${i}`}
                d={`${smoothPath(line)} L${line[line.length - 1][0]},${AREA_BOTTOM} L${line[0][0]},${AREA_BOTTOM} Z`}
                className={styles.cashFill}
                style={{ fill: INCOME }}
              />
            ) : null,
          )}
          {lines.map((line, i) =>
            line.length > 1 ? (
              <path key={`line-${i}`} d={smoothPath(line)} fill="none" strokeWidth={2} style={{ stroke: INCOME }} />
            ) : null,
          )}

          {projected && lastPoint ? (
            <g>
              <path
                d={`M${lastPoint[0]},${lastPoint[1]} L${projectionX},${projectionY}`}
                fill="none"
                strokeWidth={2}
                strokeDasharray="4 4"
                style={{ stroke: INCOME }}
              />
              <circle cx={projectionX} cy={projectionY} r={4} strokeWidth={2} className={styles.openPoint} style={{ stroke: INCOME }} />
              <text
                className={styles.chartStrong}
                x={projectionLabelAtEdge ? width - 2 : projectionX}
                y={projectionY - 10}
                textAnchor={projectionLabelAtEdge ? "end" : "middle"}
              >
                {projectionLabel}
              </text>
              {dayPlace ? (
                <text className={styles.chartText} x={dayPlace.x} y={BASE + 18} textAnchor={dayPlace.anchor}>
                  {dayLabel}
                </text>
              ) : null}
            </g>
          ) : null}

          {points.map((point, i) =>
            point ? (
              <circle
                key={`point-${i}`}
                cx={point[0]}
                cy={point[1]}
                r={i === count - 1 ? 4 : 3.5}
                strokeWidth={2}
                className={i === count - 1 ? undefined : styles.openPoint}
                style={i === count - 1 ? { fill: INCOME, stroke: INCOME } : { stroke: INCOME }}
              />
            ) : null,
          )}

          {months.map((month, i) => {
            const center = centers[i];
            if (!month.posted) {
              const blockWidth = px(step * 0.72);
              const middle = px(TOP + (BASE - TOP) / 2);
              const across = labelFitsAcross("Not posted", blockWidth);
              return (
                <g key={month.key}>
                  <rect
                    className={styles.notPosted}
                    x={px(center - blockWidth / 2)}
                    y={TOP}
                    width={blockWidth}
                    height={BASE - TOP}
                    rx={4}
                    strokeDasharray="4 4"
                  />
                  <text
                    className={styles.chartText}
                    x={px(center)}
                    y={across ? px(TOP + AREA / 2) + 4 : middle + 4}
                    textAnchor="middle"
                    transform={across ? undefined : `rotate(-90 ${px(center)} ${middle})`}
                  >
                    Not posted
                  </text>
                </g>
              );
            }
            const [inSlot, outSlot] = barSlots(center, step, 2, 10, 4);
            const inHeight = barHeight(inflow[i]);
            const outHeight = barHeight(outflow[i]);
            return (
              <g key={month.key}>
                <rect x={inSlot.x} y={BASE - inHeight} width={inSlot.width} height={inHeight} rx={2} style={{ fill: INCOME }} />
                <rect x={outSlot.x} y={BASE - outHeight} width={outSlot.width} height={outHeight} rx={2} style={{ fill: SECONDARY }} />
              </g>
            );
          })}

          <line className={styles.baseLine} x1={LEFT} x2={width - RIGHT} y1={BASE} y2={BASE} />
          <text className={styles.chartText} x={LEFT - 8} y={BASE - BARS / 2 + 4} textAnchor="end">
            In, out
          </text>
          {months.map((month, i) =>
            named(i) ? (
              <text key={`label-${month.key}`} className={styles.chartText} x={px(centers[i])} y={BASE + 18} textAnchor="middle">
                {month.label}
              </text>
            ) : null,
          )}

          {/* The pointer's targets: one whole column a month, and the projected point's own. */}
          {months.map((month, i) => (
            <rect
              key={`hit-${month.key}`}
              className={styles.hit}
              x={px(centers[i] - step / 2)}
              y={0}
              width={px(step)}
              height={HEIGHT}
              onMouseMove={track(i)}
              onClick={track(i)}
            />
          ))}
          {projected ? (
            <rect
              className={styles.hit}
              x={px(LEFT + step * count)}
              y={0}
              width={px(Math.max(0, width - RIGHT - (LEFT + step * count)))}
              height={HEIGHT}
              onMouseMove={track(count)}
              onClick={track(count)}
            />
          ) : null}
        </svg>
      </div>
      <ChartTip hover={hover} lines={hover ? tipLines(hover.index) : null} />
      <FiguresTable
        caption="Cash by month"
        head={["Month", "Cash balance", "Money in", "Money out"]}
        rows={[
          ...months.map((month, i) =>
            month.posted
              ? [monthName(month, i === count - 1), money(balance[i]), money(inflow[i]), money(outflow[i])]
              : [monthName(month, i === count - 1), "Not posted", "Not posted", "Not posted"],
          ),
          ...(projected ? [[`Projected for ${formatDate(projected.date)}`, money(projected.valueMinor), "", ""]] : []),
        ]}
      />
    </div>
  );
}
