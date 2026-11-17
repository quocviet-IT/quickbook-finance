"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Typography } from "antd";
import { plural } from "@/lib/format";

/**
 * The bar is pinned under the app header on a computer (globals.css). A table
 * below it whose header is pinned too must stop under the bar, so the bar
 * writes the room it takes, its height and the 8px above it, into
 * --filter-bar-space, and clears it when the page goes (3.0.45).
 */
function useFilterBarSpace() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    let written = "";
    const write = () => {
      written = `${Math.round(bar.getBoundingClientRect().height) + 8}px`;
      root.style.setProperty("--filter-bar-space", written);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      // Another bar may have written since; leave its figure alone.
      if (root.style.getPropertyValue("--filter-bar-space") === written) root.style.removeProperty("--filter-bar-space");
    };
  }, []);
  return ref;
}

function ResultCount({ resultCount }: { resultCount?: number }) {
  if (typeof resultCount !== "number") return null;
  return (
    <Typography.Text type="secondary" className="accounting-filter-bar__count" aria-live="polite">
      {plural(resultCount, "result")}
    </Typography.Text>
  );
}

export default function FilterBar({
  children,
  secondary,
  actions,
  resultCount,
  ariaLabel = "Filters and actions",
  className,
}: {
  children?: ReactNode;
  /**
   * A second tier of controls, which changes the whole bar's shape.
   *
   * Without it the bar is one row — controls left, actions right — which is
   * what every screen but Bank Transactions wants and gets, unchanged.
   *
   * With it the bar becomes two full-width rows. That is the point: Bank
   * Transactions has seven controls, and while the actions sat beside them
   * they left about 630px for 666px of selects, so a row broke and left one
   * select stranded on a line of its own. Giving each tier the whole width
   * and putting the actions beside the *second* tier fits both rows and
   * stops the count from floating in the middle of a wrapped block.
   */
  secondary?: ReactNode;
  actions?: ReactNode;
  resultCount?: number;
  ariaLabel?: string;
  /** A modifier, such as the report bar's, which lets the actions share the controls' lines. */
  className?: string;
}) {
  const ref = useFilterBarSpace();
  if (!secondary) {
    return (
      <section ref={ref} className={className ? `accounting-filter-bar ${className}` : "accounting-filter-bar"} aria-label={ariaLabel}>
        <div className="accounting-filter-bar__controls">{children}</div>
        <div className="accounting-filter-bar__actions">
          <ResultCount resultCount={resultCount} />
          {actions}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className="accounting-filter-bar accounting-filter-bar--tiered"
      aria-label={ariaLabel}
    >
      <div className="accounting-filter-bar__controls">{children}</div>
      <div className="accounting-filter-bar__tier">
        <div className="accounting-filter-bar__controls">{secondary}</div>
        <div className="accounting-filter-bar__actions">
          <ResultCount resultCount={resultCount} />
          {actions}
        </div>
      </div>
    </section>
  );
}
