"use client";

import type { ReactNode } from "react";
import { Typography } from "antd";

function ResultCount({ resultCount }: { resultCount?: number }) {
  if (typeof resultCount !== "number") return null;
  return (
    <Typography.Text type="secondary" className="accounting-filter-bar__count" aria-live="polite">
      {resultCount.toLocaleString("en-US")} result{resultCount === 1 ? "" : "s"}
    </Typography.Text>
  );
}

export default function FilterBar({
  children,
  secondary,
  actions,
  resultCount,
  ariaLabel = "Filters and actions",
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
}) {
  if (!secondary) {
    return (
      <section className="accounting-filter-bar" aria-label={ariaLabel}>
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
