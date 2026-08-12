"use client";
import { useState } from "react";
import {
  Alert,
  Button,
  Segmented,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { downloadCsvFile } from "@/lib/client/report-export";
import { toCsv } from "@/lib/csv";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import { formatMoney } from "@/lib/format";
import { creditStateColor, sortByCreditRisk } from "@/lib/domain/credit";
import type { CustomerCreditRow } from "@/lib/services/credit";
import { TOKENS } from "@/lib/design/tokens";
import { statusToken } from "@/lib/design/status";

type View = "attention" | "all";

const money = (minor: number) => formatMoney(minor, "USD", 2);

export default function CustomerCreditClient({
  rows,
  salesWindowDays,
  companyName,
}: {
  rows: CustomerCreditRow[];
  salesWindowDays: number;
  /** Whose books the exported file belongs to. */
  companyName: string;
}) {
  const [view, setView] = useState<View>("attention");

  const ranked = sortByCreditRisk(rows);
  const needsAttention = ranked.filter(
    (row) =>
      row.status.state === "hold" ||
      row.status.state === "over_limit" ||
      row.overdueMinor > 0,
  );
  const shown = view === "attention" ? needsAttention : ranked;

  const totalOwed = rows.reduce((sum, row) => sum + row.openBalanceMinor, 0);
  const totalOverdue = rows.reduce((sum, row) => sum + row.overdueMinor, 0);
  // Exposure above the limit, summed only over the accounts that are past it —
  // headroom elsewhere does not offset an account that is over.
  const overLimitExposure = rows.reduce((sum, row) => {
    const available = row.status.availableMinor;
    return available !== null && available < 0 ? sum + -available : sum;
  }, 0);
  const onHold = rows.filter((row) => row.creditHold).length;
  const noLimit = rows.filter((row) => row.creditLimitMinor === null).length;

  // One DSO for the business: total owed against everything invoiced in the
  // window. Averaging each customer's own DSO would weight a $50 account the
  // same as a $50,000 one.
  const windowSales = rows.reduce((sum, row) => sum + row.salesWindowMinor, 0);
  const portfolioDso =
    windowSales > 0
      ? Math.round((totalOwed / windowSales) * salesWindowDays)
      : null;

  function exportCsv() {
    downloadCsvFile(
      csvWithReportIdentity(
        toCsv(
          ranked.map((row) => ({
            customer: row.name,
            credit_limit:
              row.creditLimitMinor === null
                ? ""
                : (row.creditLimitMinor / 100).toFixed(2),
            owed: (row.openBalanceMinor / 100).toFixed(2),
            available:
              row.status.availableMinor === null
                ? ""
                : (row.status.availableMinor / 100).toFixed(2),
            overdue: (row.overdueMinor / 100).toFixed(2),
            oldest_due: row.oldestDueDate ?? "",
            dso: row.status.daysSalesOutstanding ?? "",
            state: row.status.label,
            terms_days: row.creditTermsDays ?? "",
            billing_address: row.hasBillingAddress ? "yes" : "no",
          })),
          [
            { key: "customer", header: "Customer" },
            { key: "credit_limit", header: "Credit limit" },
            { key: "owed", header: "Owed now" },
            { key: "available", header: "Available" },
            { key: "overdue", header: "Past due" },
            { key: "oldest_due", header: "Oldest due date" },
            { key: "dso", header: "DSO (days)" },
            { key: "state", header: "Credit status" },
            { key: "terms_days", header: "Terms (days)" },
            { key: "billing_address", header: "Billing address on file" },
          ],
        ),
        {
          companyName,
          title: "Customer Credit Exposure",
          subtitle: `Sales window ${salesWindowDays} days`,
          currencyCode: "USD",
        },
      ),
      "customer-credit-exposure.csv",
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Space size="large" wrap>
        <Statistic title="Owed now" value={money(totalOwed)} />
        <Statistic
          title="Past due"
          value={money(totalOverdue)}
          valueStyle={totalOverdue > 0 ? { color: statusToken("overdue").color } : undefined}
        />
        <Statistic
          title="Over limit"
          value={money(overLimitExposure)}
          valueStyle={overLimitExposure > 0 ? { color: TOKENS.intent.danger } : undefined}
        />
        <Statistic title="On credit hold" value={onHold} />
        <Statistic
          title={`DSO (last ${salesWindowDays} days)`}
          value={portfolioDso === null ? "—" : `${portfolioDso} days`}
        />
      </Space>

      {noLimit > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`${noLimit} of ${rows.length} customers have no credit limit set`}
          description="Nothing is enforced for those accounts: an invoice of any size will issue. Set a limit on the customer record to bring them under the control."
        />
      ) : null}

      <FilterBar
        resultCount={shown.length}
        ariaLabel="Customer credit filters"
        actions={
          <Button
            icon={<DownloadOutlined />}
            disabled={rows.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        }
      >
        <Segmented
          value={view}
          onChange={(value) => setView(value as View)}
          options={[
            {
              label: `Needs attention (${needsAttention.length})`,
              value: "attention",
            },
            { label: `All customers (${rows.length})`, value: "all" },
          ]}
        />
      </FilterBar>

      <DataTable<CustomerCreditRow>
        rowKey="customerId"
        dataSource={shown}
        emptyTitle={
          view === "attention" ? "Nothing needs attention" : "No customers yet"
        }
        emptyDescription={
          view === "attention"
            ? "No customer is on hold, over their limit, or carrying an overdue balance."
            : "Add a customer to start invoicing."
        }
        columns={[
          {
            title: "Customer",
            dataIndex: "name",
            render: (name: string, row) => (
              <Space size="small">
                {name}
                {row.hasBillingAddress ? null : (
                  <Tooltip title="No billing address on file; a printed invoice will have no Bill to block">
                    <Tag color="orange">No address</Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          {
            title: "Credit status",
            key: "state",
            width: 160,
            render: (_: unknown, row) => {
              const tag = (
                <Tag color={creditStateColor(row.status.state)}>
                  {row.status.label}
                </Tag>
              );
              return row.status.reasons.length ? (
                <Tooltip title={row.status.reasons.join(". ")}>{tag}</Tooltip>
              ) : (
                tag
              );
            },
          },
          {
            title: "Credit limit",
            key: "limit",
            width: 130,
            align: "right",
            render: (_: unknown, row) =>
              row.creditLimitMinor === null ? (
                <Typography.Text type="secondary">Not set</Typography.Text>
              ) : (
                money(row.creditLimitMinor)
              ),
          },
          {
            title: "Owed now",
            dataIndex: "openBalanceMinor",
            width: 130,
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Available",
            key: "available",
            width: 130,
            align: "right",
            render: (_: unknown, row) =>
              row.status.availableMinor === null ? (
                "—"
              ) : (
                <Typography.Text
                  type={row.status.availableMinor < 0 ? "danger" : undefined}
                >
                  {money(row.status.availableMinor)}
                </Typography.Text>
              ),
          },
          {
            title: "Past due",
            dataIndex: "overdueMinor",
            width: 130,
            align: "right",
            render: (value: number, row) =>
              value > 0 ? (
                <Tooltip
                  title={
                    row.oldestDueDate
                      ? `Oldest due ${row.oldestDueDate}`
                      : undefined
                  }
                >
                  <Typography.Text type="danger">
                    {money(value)}
                  </Typography.Text>
                </Tooltip>
              ) : (
                money(0)
              ),
          },
          {
            title: "DSO",
            key: "dso",
            width: 100,
            align: "right",
            render: (_: unknown, row) =>
              row.status.daysSalesOutstanding === null
                ? "—"
                : `${row.status.daysSalesOutstanding} d`,
          },
          {
            title: "Terms",
            dataIndex: "creditTermsDays",
            width: 100,
            align: "right",
            render: (value: number | null) =>
              value === null ? "Default" : `${value} d`,
          },
        ]}
      />
    </Space>
  );
}
