"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Card,
  Col,
  DatePicker,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import type { FixedAssetStatus } from "@/lib/db/types";
import type {
  AssetDepreciationDetail,
  FixedAssetView,
} from "@/lib/services/fixed-assets";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import { formatMoney } from "@/lib/format";

type ReportView = "register" | "depreciation";
type DateRange = [Dayjs | null, Dayjs | null] | null;

const ASSET_STATUS: Record<FixedAssetStatus, { label: string; color: string }> = {
  in_service: { label: "In service", color: "blue" },
  fully_depreciated: { label: "Fully depreciated", color: "green" },
  disposed: { label: "Disposed", color: "default" },
};

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: "default" },
  opening: { label: "Opening balance", color: "cyan" },
  posted: { label: "Posted", color: "green" },
  cancelled: { label: "Cancelled", color: "default" },
};

export default function FixedAssetReportClient({
  assets,
  depreciation,
  companyName,
  currencyCode,
  currencyDecimals,
}: {
  assets: FixedAssetView[];
  depreciation: AssetDepreciationDetail[];
  companyName: string;
  currencyCode: string;
  currencyDecimals: number;
}) {
  const [view, setView] = useState<ReportView>("register");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<FixedAssetStatus | "all">("all");
  const [dateRange, setDateRange] = useState<DateRange>(null);
  const money = (value: number) => formatMoney(value, currencyCode, currencyDecimals);

  const categories = useMemo(
    () => [...new Set(assets.map((asset) => asset.category))].sort(),
    [assets],
  );

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        if (category !== "all" && asset.category !== category) return false;
        if (status !== "all" && asset.status !== status) return false;
        if (dateRange?.[0] && asset.in_service_date < dateRange[0].format("YYYY-MM-DD")) {
          return false;
        }
        if (dateRange?.[1] && asset.in_service_date > dateRange[1].format("YYYY-MM-DD")) {
          return false;
        }
        return true;
      }),
    [assets, category, dateRange, status],
  );

  const filteredDepreciation = useMemo(
    () =>
      depreciation.filter((row) => {
        if (category !== "all" && row.category !== category) return false;
        if (status !== "all" && row.asset_status !== status) return false;
        if (dateRange?.[0] && row.period_end < dateRange[0].format("YYYY-MM-DD")) return false;
        if (dateRange?.[1] && row.period_end > dateRange[1].format("YYYY-MM-DD")) return false;
        return true;
      }),
    [category, dateRange, depreciation, status],
  );

  const registerTotals = useMemo(
    () => ({
      cost: filteredAssets.reduce((sum, asset) => sum + Number(asset.cost_minor), 0),
      accumulated: filteredAssets.reduce(
        (sum, asset) => sum + Number(asset.accumulated_depreciation_minor),
        0,
      ),
      bookValue: filteredAssets.reduce(
        (sum, asset) => sum + Number(asset.net_book_value_minor),
        0,
      ),
    }),
    [filteredAssets],
  );

  const depreciationTotals = useMemo(
    () => ({
      planned: filteredDepreciation.reduce(
        (sum, row) => sum + Number(row.planned_amount_minor),
        0,
      ),
      recognized: filteredDepreciation.reduce(
        (sum, row) => sum + Number(row.posted_amount_minor),
        0,
      ),
      unposted: filteredDepreciation
        .filter((row) => row.status !== "cancelled")
        .reduce(
          (sum, row) =>
            sum + Number(row.planned_amount_minor) - Number(row.posted_amount_minor),
          0,
        ),
    }),
    [filteredDepreciation],
  );

  const subtitle = `${dateRange?.[0]?.format("MMM D, YYYY") ?? "All dates"} – ${
    dateRange?.[1]?.format("MMM D, YYYY") ?? "present"
  } · ${category === "all" ? "All categories" : category}`;

  const exportSheet: ReportExportSheet = useMemo(
    () =>
      view === "register"
        ? {
            fileName: "fixed-asset-register",
            companyName,
            title: "Fixed Asset Register",
            subtitle,
            currencyCode,
            columns: [
              { key: "asset_number", header: "Asset Number", width: 16 },
              { key: "name", header: "Asset", width: 28 },
              { key: "category", header: "Category", width: 26 },
              { key: "in_service", header: "In Service", width: 14 },
              { key: "status", header: "Status", width: 16 },
              { key: "cost", header: "Cost", kind: "money", width: 16 },
              {
                key: "accumulated",
                header: "Accumulated Depreciation",
                kind: "money",
                width: 22,
              },
              { key: "book_value", header: "Net Book Value", kind: "money", width: 18 },
              { key: "disposal_gain_loss", header: "Disposal Gain / Loss", kind: "money", width: 20 },
            ],
            rows: filteredAssets.map((asset) => ({
              asset_number: asset.asset_number,
              name: asset.name,
              category: asset.category,
              in_service: asset.in_service_date,
              status: ASSET_STATUS[asset.status].label,
              cost: Number(asset.cost_minor) / 10 ** currencyDecimals,
              accumulated:
                Number(asset.accumulated_depreciation_minor) / 10 ** currencyDecimals,
              book_value: Number(asset.net_book_value_minor) / 10 ** currencyDecimals,
              disposal_gain_loss:
                asset.disposal_gain_loss_minor === null
                  ? null
                  : Number(asset.disposal_gain_loss_minor) / 10 ** currencyDecimals,
            })),
          }
        : {
            fileName: "fixed-asset-depreciation-detail",
            companyName,
            title: "Fixed Asset Depreciation Detail",
            subtitle,
            currencyCode,
            columns: [
              { key: "asset_number", header: "Asset Number", width: 16 },
              { key: "asset_name", header: "Asset", width: 28 },
              { key: "category", header: "Category", width: 26 },
              { key: "period_end", header: "Period End", width: 14 },
              { key: "status", header: "Status", width: 16 },
              { key: "planned", header: "Planned", kind: "money", width: 16 },
              { key: "recognized", header: "Recognized", kind: "money", width: 16 },
              { key: "journal", header: "Journal Entry", width: 18 },
            ],
            rows: filteredDepreciation.map((row) => ({
              asset_number: row.asset_number,
              asset_name: row.asset_name,
              category: row.category,
              period_end: row.period_end,
              status: SCHEDULE_STATUS[row.status]?.label ?? row.status,
              planned: Number(row.planned_amount_minor) / 10 ** currencyDecimals,
              recognized: Number(row.posted_amount_minor) / 10 ** currencyDecimals,
              journal: row.journal_entry_number,
            })),
          },
    [
      companyName,
      currencyCode,
      filteredAssets,
      filteredDepreciation,
      subtitle,
      view,
      currencyDecimals,
    ],
  );

  const assetColumns: TableColumnsType<FixedAssetView> = [
    {
      title: "Asset",
      key: "asset",
      width: 280,
      render: (_value, asset) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {asset.asset_number} · {asset.name}
          </Typography.Text>
          <Typography.Text type="secondary">{asset.category}</Typography.Text>
        </Space>
      ),
    },
    { title: "In service", dataIndex: "in_service_date", width: 115 },
    {
      title: "Status",
      dataIndex: "status",
      width: 135,
      render: (value: FixedAssetStatus) => (
        <Tag color={ASSET_STATUS[value].color}>{ASSET_STATUS[value].label}</Tag>
      ),
    },
    {
      title: "Cost",
      dataIndex: "cost_minor",
      width: 140,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Accumulated depreciation",
      dataIndex: "accumulated_depreciation_minor",
      width: 190,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Net book value",
      dataIndex: "net_book_value_minor",
      width: 150,
      align: "right",
      render: (value: number) => <Typography.Text strong>{money(value)}</Typography.Text>,
    },
    {
      title: "Disposal result",
      dataIndex: "disposal_gain_loss_minor",
      width: 160,
      align: "right",
      render: (value: number | null, asset) =>
        value === null ? (
          "—"
        ) : (
          <Space direction="vertical" size={0}>
            <Typography.Text type={value < 0 ? "danger" : "success"}>
              {value >= 0 ? "Gain " : "Loss "}
              {money(Math.abs(value))}
            </Typography.Text>
            {asset.disposal_journal_entry_id ? (
              <Link href={`/journal?entry=${asset.disposal_journal_entry_id}`}>View journal</Link>
            ) : null}
          </Space>
        ),
    },
  ];

  const depreciationColumns: TableColumnsType<AssetDepreciationDetail> = [
    {
      title: "Asset",
      key: "asset",
      width: 280,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {row.asset_number} · {row.asset_name}
          </Typography.Text>
          <Typography.Text type="secondary">{row.category}</Typography.Text>
        </Space>
      ),
    },
    { title: "Period end", dataIndex: "period_end", width: 115 },
    {
      title: "Planned",
      dataIndex: "planned_amount_minor",
      width: 145,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Recognized",
      dataIndex: "posted_amount_minor",
      width: 145,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 145,
      render: (value: string) => {
        const config = SCHEDULE_STATUS[value] ?? { label: value, color: "default" };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "Journal entry",
      dataIndex: "journal_entry_id",
      width: 145,
      render: (value: string | null, row) =>
        value ? <Link href={`/journal?entry=${value}`}>{row.journal_entry_number ?? "View"}</Link> : "—",
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Segmented<ReportView>
        value={view}
        onChange={setView}
        options={[
          { value: "register", label: "Asset Register" },
          { value: "depreciation", label: "Depreciation Detail" },
        ]}
      />

      <FilterBar
        resultCount={view === "register" ? filteredAssets.length : filteredDepreciation.length}
        ariaLabel="Fixed asset report filters"
        actions={
          <ReportExportButtons
            sheet={exportSheet}
            disabled={
              view === "register" ? filteredAssets.length === 0 : filteredDepreciation.length === 0
            }
          />
        }
      >
        <Space wrap>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(value) => setDateRange(value)}
            format="MM/DD/YYYY"
            presets={[
              { label: "Year to date", value: [dayjs().startOf("year"), dayjs()] },
              {
                label: "Prior year",
                value: [
                  dayjs().subtract(1, "year").startOf("year"),
                  dayjs().subtract(1, "year").endOf("year"),
                ],
              },
            ]}
          />
          <Select
            value={category}
            onChange={setCategory}
            style={{ width: 240 }}
            options={[
              { value: "all", label: "All categories" },
              ...categories.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 180 }}
            options={[
              { value: "all", label: "All asset statuses" },
              { value: "in_service", label: "In service" },
              { value: "fully_depreciated", label: "Fully depreciated" },
              { value: "disposed", label: "Disposed" },
            ]}
          />
        </Space>
      </FilterBar>

      {view === "register" ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Assets" value={filteredAssets.length} />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Historical cost" value={money(registerTotals.cost)} />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic
                  title="Accumulated depreciation"
                  value={money(registerTotals.accumulated)}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Net book value" value={money(registerTotals.bookValue)} />
              </Card>
            </Col>
          </Row>
          <DataTable
            rowKey="id"
            columns={assetColumns}
            dataSource={filteredAssets}
            pagination={{ pageSize: 25 }}
            scroll={{ x: 1280 }}
            emptyTitle="No assets match the report filters"
          />
        </>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small">
                <Statistic title="Scheduled depreciation" value={money(depreciationTotals.planned)} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small">
                <Statistic title="Recognized depreciation" value={money(depreciationTotals.recognized)} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small">
                <Statistic
                  title="Remaining scheduled"
                  value={money(depreciationTotals.unposted)}
                  valueStyle={{ color: depreciationTotals.unposted > 0 ? "#b45309" : undefined }}
                />
              </Card>
            </Col>
          </Row>
          <DataTable
            rowKey="id"
            columns={depreciationColumns}
            dataSource={filteredDepreciation}
            pagination={{ pageSize: 25 }}
            scroll={{ x: 980 }}
            emptyTitle="No depreciation rows match the report filters"
          />
        </>
      )}
    </Space>
  );
}
