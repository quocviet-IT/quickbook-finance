"use client";
import { Tag, Typography } from "antd";

/**
 * Whose books this report is.
 *
 * One Book holds a company per Postgres schema, so the figures were never
 * mixed — a query in one schema cannot see another's rows. What people could
 * not do was *tell*: a Fixed Asset Register or a General Ledger on screen, in a
 * print-out or in a screenshot named no entity, and with more than ten
 * companies open in tabs that is a statement waiting to be filed against the
 * wrong one.
 *
 * `ReportsClient` said as much in a comment beside its own heading and only
 * ever applied it to a handful of statements. This is that line, made shared,
 * so a report cannot be added without one.
 *
 * A Client Component because it reads `Typography.Text`: antd ships
 * "use client", so a Server Component reading a compound sub-component gets a
 * client-reference proxy and throws at render time (CLAUDE.md §4).
 */
export default function ReportEntityBadge({
  companyName,
  currencyCode,
  isSample = false,
}: {
  companyName: string;
  /** Base currency, because two companies may report in different ones. */
  currencyCode?: string;
  /** Marks a demonstration company, so its figures are never mistaken for real. */
  isSample?: boolean;
}) {
  return (
    <Typography.Text strong className="report-result__entity">
      {companyName}
      {currencyCode ? (
        <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
          {" · "}
          {currencyCode}
        </Typography.Text>
      ) : null}
      {isSample ? (
        <>
          {" "}
          <Tag color="orange">sample company</Tag>
        </>
      ) : null}
    </Typography.Text>
  );
}
