"use client";

import { TOKENS } from "@/lib/design/tokens";
import { axisTicks } from "@/lib/domain/chart-axis";
import type { CashForecast } from "@/lib/domain/forecast";
import { chartPoints } from "@/lib/domain/forecast";
import styles from "./cash-forecast.module.css";

/**
 * Cash at the end of each week as a line, with the money in and out of that
 * week as bars beneath it. A table of the same figures sits beside it for
 * readers who do not use the picture.
 */
export default function ForecastChart({
  forecast,
  formatCompact,
  formatMoney,
}: {
  forecast: CashForecast;
  formatCompact: (minor: number) => string;
  formatMoney: (minor: number) => string;
}) {
  const points = chartPoints(forecast);
  const width = 720;
  const height = 280;
  const plot = { left: 64, right: 18, top: 18, bottom: 40 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const values = points.flatMap((p) => [p.inMinor, p.outMinor, p.closingMinor, forecast.openingMinor]);
  const domainMin = Math.min(0, ...values);
  const domainMax = Math.max(1, ...values);
  const span = Math.max(1, domainMax - domainMin);
  const y = (value: number) => plot.top + ((domainMax - value) / span) * plotHeight;
  const group = plotWidth / points.length;
  const barWidth = Math.min(16, group * 0.3);
  const center = (index: number) => plot.left + group * index + group / 2;
  const line = points.map((p, index) => `${center(index)},${y(p.closingMinor)}`).join(" ");

  return (
    <div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={styles.line} style={{ backgroundColor: TOKENS.series.net }} />
          Cash at week end
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ backgroundColor: TOKENS.series.income }} />
          Money in
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ backgroundColor: TOKENS.series.expense }} />
          Money out
        </span>
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cash at the end of each of the next thirteen weeks, with money in and money out per week"
      >
        {axisTicks(domainMax, span).map((tick, i) => (
          <g key={i}>
            <line x1={plot.left} x2={width - plot.right} y1={y(tick)} y2={y(tick)} stroke={TOKENS.series.grid} strokeDasharray="4 4" />
            <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" className={styles.axis}>
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        <line x1={plot.left} x2={width - plot.right} y1={y(0)} y2={y(0)} stroke={TOKENS.series.axis} />
        {points.map((p, index) => (
          <g key={index}>
            <rect
              x={center(index) - barWidth - 1}
              y={Math.min(y(p.inMinor), y(0))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(0) - y(p.inMinor)))}
              rx={3}
              fill={TOKENS.series.income}
            >
              <title>{`${p.label} money in: ${formatMoney(p.inMinor)}`}</title>
            </rect>
            <rect
              x={center(index) + 1}
              y={Math.min(y(p.outMinor), y(0))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(0) - y(p.outMinor)))}
              rx={3}
              fill={TOKENS.series.expense}
            >
              <title>{`${p.label} money out: ${formatMoney(p.outMinor)}`}</title>
            </rect>
            <text x={center(index)} y={height - 14} textAnchor="middle" className={styles.axis}>
              {p.label}
            </text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke={TOKENS.series.net} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, index) => (
          <circle key={index} cx={center(index)} cy={y(p.closingMinor)} r={4} fill={TOKENS.text.onDark} stroke={TOKENS.series.net} strokeWidth={3}>
            <title>{`${p.label} cash at week end: ${formatMoney(p.closingMinor)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
