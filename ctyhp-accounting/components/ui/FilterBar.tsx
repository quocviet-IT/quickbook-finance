"use client";

import type { ReactNode } from "react";
import { Typography } from "antd";

export default function FilterBar({
  children,
  actions,
  resultCount,
  ariaLabel = "Filters and actions",
}: {
  children?: ReactNode;
  actions?: ReactNode;
  resultCount?: number;
  ariaLabel?: string;
}) {
  return (
    <section className="accounting-filter-bar" aria-label={ariaLabel}>
      <div className="accounting-filter-bar__controls">{children}</div>
      <div className="accounting-filter-bar__actions">
        {typeof resultCount === "number" && (
          <Typography.Text type="secondary" className="accounting-filter-bar__count" aria-live="polite">
            {resultCount.toLocaleString("en-US")} result{resultCount === 1 ? "" : "s"}
          </Typography.Text>
        )}
        {actions}
      </div>
    </section>
  );
}
