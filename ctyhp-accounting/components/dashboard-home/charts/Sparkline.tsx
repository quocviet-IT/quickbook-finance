import styles from "../dashboard-home.module.css";
import { px, runs, smoothPath, sparkPoints } from "./geometry";

const WIDTH = 92;
const HEIGHT = 32;

/**
 * Six months as a small line beside a figure. Decoration for a figure whose
 * sentence says the same thing in words, so it is hidden from screen readers.
 *
 * Drawn at exactly its own size (92 by 32), so nothing in it is scaled. A
 * month not entered yet has no point: it is a dashed block, never a drop to
 * zero, the same as on the larger charts.
 */
export default function Sparkline({
  values,
  posted,
  color,
}: {
  values: readonly number[];
  posted: readonly boolean[];
  /** A `var(--ob-…)` color. */
  color: string;
}) {
  const { points, slot } = sparkPoints(values, posted, WIDTH, HEIGHT);
  const lines = runs(points);
  const last = [...points].reverse().find((point) => point !== null) ?? null;
  const gapWidth = px(Math.max(8, slot * 0.7));
  // Centered on the month, and kept whole inside the 92 pixels at either end.
  const gapX = (i: number) => px(Math.min(WIDTH - gapWidth - 1, Math.max(1, 2 + i * slot - gapWidth / 2)));
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
      focusable="false"
    >
      {points.map((point, i) =>
        point === null ? (
          <rect
            key={`gap-${i}`}
            className={styles.sparkGap}
            x={gapX(i)}
            y={3}
            width={gapWidth}
            height={HEIGHT - 6}
            rx={2}
            strokeDasharray="3 3"
          />
        ) : null,
      )}
      {lines.map((line, i) =>
        line.length > 1 ? (
          <path key={`line-${i}`} d={smoothPath(line)} fill="none" strokeWidth={1.75} style={{ stroke: color }} />
        ) : null,
      )}
      {last ? <circle cx={last[0]} cy={last[1]} r={2.5} style={{ fill: color }} /> : null}
    </svg>
  );
}
