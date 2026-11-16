"use client";
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import styles from "../dashboard-home.module.css";

/**
 * What every Dashboard chart shares: it is drawn at the width it is shown at,
 * and a pointer over it shows a tooltip with the month and the exact amount.
 *
 * Drawing at the measured width (rather than scaling one fixed drawing to fit)
 * is what keeps the labels at 12px on a narrow card and a wide one alike. Until
 * the box is measured, and while a tab hides it (width 0), the chart keeps the
 * last width it had.
 */
export function useChartWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.floor(element.clientWidth);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export interface ChartHover {
  /** Which mark is under the pointer: a month's index, or a slice's. */
  index: number;
  /** The pointer, in pixels from the chart box's top left corner. */
  x: number;
  y: number;
}

/** The pointer over a chart's marks, for its tooltip and the highlighted month. */
export function useChartHover() {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const track = useCallback(
    (index: number) => (event: MouseEvent) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({ index, x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    [],
  );
  const leave = useCallback(() => setHover(null), []);
  return { box, hover, track, leave };
}

/**
 * The tooltip itself: the lines it is given, above the pointer, kept inside
 * the chart box. Hidden from screen readers, who have the table of figures
 * every chart carries instead.
 */
export function ChartTip({ hover, lines }: { hover: ChartHover | null; lines: readonly string[] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !hover) return;
    const parent = element.parentElement;
    const room = parent ? parent.clientWidth : 0;
    const width = element.offsetWidth;
    const left = Math.max(0, Math.min(hover.x - width / 2, room - width));
    const top = Math.max(0, hover.y - element.offsetHeight - 12);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [hover, lines]);
  if (!hover || !lines || lines.length === 0) return null;
  return (
    <div ref={ref} className={styles.tip} aria-hidden="true">
      {lines.map((line, i) => (
        <span key={i} className={i === 0 ? styles.tipHead : undefined}>
          {line}
        </span>
      ))}
    </div>
  );
}

/** A visually hidden table of a chart's figures: what a screen reader reads in place of the drawing. */
export function FiguresTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <table className="accounting-sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((cell, i) => (
            <th key={i} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={c}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
