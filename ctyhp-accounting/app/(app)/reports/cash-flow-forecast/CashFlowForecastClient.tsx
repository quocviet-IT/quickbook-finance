"use client";
import { useState } from "react";
import {
  Alert,
  Button,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { downloadCsvFile } from "@/lib/client/report-export";
import { toCsv } from "@/lib/csv";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import { formatMoney } from "@/lib/format";
import {
  describeForecastBasis,
  type CashFlowForecast,
  type ForecastBucket,
  type OpenItem,
} from "@/lib/domain/forecast";
import { outstandingAge } from "@/lib/domain/settlement";
import { TOKENS } from "@/lib/design/tokens";
import { statusToken } from "@/lib/design/status";

const money = (minor: number) => formatMoney(minor, "USD", 2);

type View = "weeks" | "items";

export default function CashFlowForecastClient({
  forecast,
  openItems,
  companyName,
}: {
  forecast: CashFlowForecast;
  openItems: OpenItem[];
  /** Whose books the exported file belongs to. */
  companyName: string;
}) {
  const [view, setView] = useState<View>("weeks");

  const expectedIn = forecast.buckets.reduce(
    (sum, b) => sum + b.expectedInMinor,
    0,
  );
  const expectedOut = forecast.buckets.reduce(
    (sum, b) => sum + b.expectedOutMinor,
    0,
  );
  const overdueIn = forecast.buckets.reduce(
    (sum, b) => sum + b.overdueInMinor,
    0,
  );
  const closing = forecast.buckets.at(-1)?.cumulativeMinor ?? 0;
  const worstWeek = forecast.buckets.reduce<ForecastBucket | null>(
    (worst, bucket) =>
      worst === null || bucket.cumulativeMinor < worst.cumulativeMinor
        ? bucket
        : worst,
    null,
  );

  function exportCsv() {
    downloadCsvFile(
      csvWithReportIdentity(
        toCsv(
          forecast.buckets.map((bucket) => ({
            week: bucket.weekStart,
            scheduled_in: (bucket.scheduledInMinor / 100).toFixed(2),
            scheduled_out: (bucket.scheduledOutMinor / 100).toFixed(2),
            expected_in: (bucket.expectedInMinor / 100).toFixed(2),
            expected_out: (bucket.expectedOutMinor / 100).toFixed(2),
            net: (bucket.expectedNetMinor / 100).toFixed(2),
            cumulative: (bucket.cumulativeMinor / 100).toFixed(2),
          })),
          [
            { key: "week", header: "Week beginning" },
            { key: "scheduled_in", header: "Scheduled in" },
            { key: "scheduled_out", header: "Scheduled out" },
            { key: "expected_in", header: "Expected in" },
            { key: "expected_out", header: "Expected out" },
            { key: "net", header: "Net" },
            { key: "cumulative", header: "Cumulative" },
          ],
        ),
        {
          companyName,
          title: "Cash Flow Forecast",
          subtitle: `As of ${forecast.asOf} · ${forecast.weeks} weeks`,
          currencyCode: "USD",
        },
      ),
      `cash-flow-forecast-${forecast.asOf}.csv`,
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Space size="large" wrap>
        <Statistic
          title={`Expected in (${forecast.weeks} weeks)`}
          value={money(expectedIn)}
        />
        <Statistic title="Expected out" value={money(expectedOut)} />
        <Statistic
          title="Net over the horizon"
          value={money(closing)}
          valueStyle={closing < 0 ? { color: TOKENS.money.negative } : { color: TOKENS.money.positive }}
        />
        <Statistic
          title="Already overdue"
          value={money(overdueIn)}
          valueStyle={overdueIn > 0 ? { color: statusToken("overdue").color } : undefined}
        />
      </Space>

      <Alert
        type="info"
        showIcon
        message={describeForecastBasis(forecast)}
        description={
          "Every amount here is an open invoice or bill that already exists in the ledger — only the timing is estimated. " +
          "Overdue documents are expected in the current week, not in the past."
        }
      />

      {worstWeek && worstWeek.cumulativeMinor < 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`Cash turns negative in the week of ${worstWeek.weekStart}`}
          description={`On this projection the running position reaches ${money(worstWeek.cumulativeMinor)} that week. This counts receivables and payables only — it is not a bank balance.`}
        />
      ) : null}

      {forecast.beyondHorizonInMinor > 0 ||
      forecast.beyondHorizonOutMinor > 0 ? (
        <Typography.Text type="secondary">
          Beyond the {forecast.weeks}-week horizon:{" "}
          {money(forecast.beyondHorizonInMinor)} in,{" "}
          {money(forecast.beyondHorizonOutMinor)} out.
        </Typography.Text>
      ) : null}

      <FilterBar
        resultCount={
          view === "weeks" ? forecast.buckets.length : openItems.length
        }
        ariaLabel="Cash flow forecast views"
        actions={
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      >
        <Segmented
          value={view}
          onChange={(value) => setView(value as View)}
          options={[
            { label: "By week", value: "weeks" },
            { label: `Open items (${openItems.length})`, value: "items" },
          ]}
        />
      </FilterBar>

      {view === "weeks" ? (
        <Table<ForecastBucket>
          rowKey="weekStart"
          size="small"
          pagination={false}
          dataSource={forecast.buckets}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "Week beginning",
              dataIndex: "weekStart",
              width: 150,
              render: (value: string, row) =>
                row.overdueInMinor > 0 || row.overdueOutMinor > 0 ? (
                  <Space size="small">
                    {value}
                    <Tag color="red">includes overdue</Tag>
                  </Space>
                ) : (
                  value
                ),
            },
            {
              title: "Scheduled in",
              dataIndex: "scheduledInMinor",
              width: 130,
              align: "right",
              render: (v: number) => money(v),
            },
            {
              title: "Expected in",
              dataIndex: "expectedInMinor",
              width: 130,
              align: "right",
              render: (v: number) => <b>{money(v)}</b>,
            },
            {
              title: "Scheduled out",
              dataIndex: "scheduledOutMinor",
              width: 140,
              align: "right",
              render: (v: number) => money(v),
            },
            {
              title: "Expected out",
              dataIndex: "expectedOutMinor",
              width: 140,
              align: "right",
              render: (v: number) => <b>{money(v)}</b>,
            },
            {
              title: "Net",
              dataIndex: "expectedNetMinor",
              width: 130,
              align: "right",
              render: (v: number) => (
                <Typography.Text type={v < 0 ? "danger" : undefined}>
                  {money(v)}
                </Typography.Text>
              ),
            },
            {
              title: "Cumulative",
              dataIndex: "cumulativeMinor",
              width: 140,
              align: "right",
              render: (v: number) => (
                <Typography.Text type={v < 0 ? "danger" : undefined} strong>
                  {money(v)}
                </Typography.Text>
              ),
            },
          ]}
        />
      ) : (
        <DataTable<OpenItem>
          rowKey="documentId"
          dataSource={openItems}
          emptyTitle="Nothing is open"
          emptyDescription="No invoice or bill is waiting to be settled."
          columns={[
            {
              title: "Side",
              dataIndex: "side",
              width: 120,
              render: (side: string) => (
                <Tag color={side === "receivable" ? "green" : "volcano"}>
                  {side === "receivable" ? "Receivable" : "Payable"}
                </Tag>
              ),
            },
            { title: "Number", dataIndex: "documentNumber", width: 150 },
            { title: "Customer / vendor", dataIndex: "partyName" },
            { title: "Due", dataIndex: "dueDate", width: 120 },
            {
              title: "Status",
              key: "age",
              width: 140,
              render: (_: unknown, row) => {
                const age = outstandingAge({
                  issueDate: row.dueDate,
                  dueDate: row.dueDate,
                  asOf: forecast.asOf,
                });
                return age.isOverdue ? (
                  <Typography.Text type="danger">
                    {age.overdueDays} d overdue
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">
                    Not yet due
                  </Typography.Text>
                );
              },
            },
            {
              title: "Balance",
              dataIndex: "balanceMinor",
              width: 140,
              align: "right",
              render: (v: number) => money(v),
            },
          ]}
        />
      )}
    </Space>
  );
}
