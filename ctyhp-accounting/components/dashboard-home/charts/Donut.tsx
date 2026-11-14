"use client";
import styles from "../dashboard-home.module.css";
import { ChartTip, FiguresTable, useChartHover } from "./ChartFrame";
import { donutSlices, px, sharePercent } from "./geometry";

/** Drawn at exactly its own size, so the figure in the middle is 18px and its word 12px. */
const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 58;
const RING = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The white space between two slices, along the ring. */
const SLICE_GAP = 2;

export interface DonutLine {
  key: string;
  name: string;
  amountMinor: number;
  /** A `var(--ob-…)` color. */
  color: string;
}

/**
 * A ring of the positive lines' shares, the real total in its middle. A line
 * at zero or below has no slice; the legend beside the ring lists it with its
 * amount, so the lines there still add up to the total.
 */
export default function Donut({
  lines,
  totalMinor,
  money,
  compact,
  word,
  label,
  caption,
}: {
  lines: readonly DonutLine[];
  totalMinor: number;
  money: (minor: number) => string;
  compact: (minor: number) => string;
  /** The word under the figure in the middle: "spent". */
  word: string;
  label: string;
  caption: string;
}) {
  const { box, hover, track, leave } = useChartHover();
  const slices = donutSlices(lines, (line) => line.amountMinor, CIRCUMFERENCE);
  const tipLines = (index: number): string[] | null => {
    const slice = slices[index];
    if (!slice) return null;
    const share = sharePercent(slice.item.amountMinor, totalMinor);
    return [slice.item.name, share === null ? money(slice.item.amountMinor) : `${money(slice.item.amountMinor)} (${share}%)`];
  };
  return (
    <div ref={box} className={styles.donutBox}>
      <svg
        className={styles.donutSvg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={label}
        onMouseLeave={leave}
      >
        <circle className={styles.donutTrack} cx={CENTER} cy={CENTER} r={RADIUS} fill="none" strokeWidth={RING} />
        {slices.map((slice, i) => (
          <circle
            key={slice.item.key}
            className={styles.donutSlice}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            strokeWidth={hover?.index === i ? RING + 4 : RING}
            strokeDasharray={`${px(Math.max(slice.length - (slices.length > 1 ? SLICE_GAP : 0), 0))} ${px(CIRCUMFERENCE)}`}
            strokeDashoffset={px(-slice.offset)}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ stroke: slice.item.color }}
            onMouseMove={track(i)}
            onClick={track(i)}
          />
        ))}
        <text className={styles.donutFigure} x={CENTER} y={CENTER + 2} textAnchor="middle">
          {compact(totalMinor)}
        </text>
        <text className={styles.chartText} x={CENTER} y={CENTER + 20} textAnchor="middle">
          {word}
        </text>
      </svg>
      <ChartTip hover={hover} lines={hover ? tipLines(hover.index) : null} />
      <FiguresTable
        caption={caption}
        head={["Account", "Amount", "Share"]}
        rows={lines.map((line) => {
          const share = sharePercent(line.amountMinor, totalMinor);
          return [line.name, money(line.amountMinor), share === null ? "" : `${share}%`];
        })}
      />
    </div>
  );
}
