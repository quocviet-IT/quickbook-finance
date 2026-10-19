"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Card,
  Col,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import ReportBar from "@/components/reports/ReportBar";
import { presetRange, type PeriodPreset, type PresetContext } from "@/lib/domain/report-presets";
import type { FixedAssetStatus } from "@/lib/db/types";
import type {
  AssetDepreciationDetail,
  FixedAssetView,
} from "@/lib/services/fixed-assets";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import { formatDate, formatMoney } from "@/lib/format";
import { TOKENS } from "@/lib/design/tokens";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

type ReportView = "register" | "depreciation";
/** The dates the report is struck for. "All dates" is no filter at all. */
interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
}

const ASSET_STATUS: Record<FixedAssetStatus, { label: string; color: string }> = {
  in_service: { label: "In service", color: "blue" },
  fully_depreciated: { label: "Fully depreciated", color: "green" },
  disposed: { label: "Disposed", color: "default" },
};

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: "default" },
  opening: { label: "Opening balance", color: "cyan" },
  posted: { label: "Posted", color: "green" },
  cancelled: { label: "Canceled", color: "default" },
};

// Rows a page for the two tables on this screen. See table-pagination.ts for
// why these have to live in state rather than as literals on `pagination`.
const ASSET_REGISTER_DEFAULT_PAGE_SIZE = 25;
const DEPRECIATION_DEFAULT_PAGE_SIZE = 25;

export default function FixedAssetReportClient({
  assets,
  depreciation,
  companyName,
  currencyCode,
  currencyDecimals,
  presets,
}: {
  assets: FixedAssetView[];
  depreciation: AssetDepreciationDetail[];
  companyName: string;
  currencyCode: string;
  currencyDecimals: number;
  presets: PresetContext;
}) {
  const [view, setView] = useState<ReportView>("register");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<FixedAssetStatus | "all">("all");
  // Opens on All dates, as the report always has: every asset, unfiltered.
  const everything = useMemo<Period>(() => ({ preset: "all", ...presetRange("all", presets) }), [presets]);
  const [draft, setDraft] = useState<Period>(everything);
  const [applied, setApplied] = useState<Period>(everything);
  const dateRange = applied.preset === "all" ? null : { from: applied.from, to: applied.to };
  const [assetsPageSize, setAssetsPageSize] = useState<number>(ASSET_REGISTER_DEFAULT_PAGE_SIZE);
  const [depreciationPageSize, setDepreciationPageSize] = useState<number>(
    DEPRECIATION_DEFAULT_PAGE_SIZE,
  );
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
        if (dateRange && asset.in_service_date < dateRange.from) return false;
        if (dateRange && asset.in_service_date > dateRange.to) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, category, applied, status],
  );

  const filteredDepreciation = useMemo(
    () =>
      depreciation.filter((row) => {
        if (category !== "all" && row.category !== category) return false;
        if (status !== "all" && row.asset_status !== status) return false;
        if (dateRange && row.period_end < dateRange.from) return false;
        if (dateRange && row.period_end > dateRange.to) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category, applied, depreciation, status],
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

  const subtitle = `${dateRange ? `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}` : "All dates"} · ${
    category === "all" ? "All categories" : category
  }`;

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

  const rowCount = view === "register" ? filteredAssets.length : filteredDepreciation.length;

  const assetColumns: TableColumnsType<FixedAssetView> = [
    {
      // The elastic column, with the category under the name.
      ...flexColumn<FixedAssetView>({
        title: "Asset",
        key: "asset",
        render: (_value: unknown, asset: FixedAssetView) => (
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong title={`${asset.asset_number} · ${asset.name}`}>
              {asset.asset_number} · {asset.name}
            </Typography.Text>
            {secondaryLine(asset.category)}
          </div>
        ),
      }),
    },
    { title: "In service", dataIndex: "in_service_date", width: COLUMN.DATE, render: (v: string) => formatDate(v) },
    {
      title: "Status",
      dataIndex: "status",
      width: COLUMN.STATUS,
      render: (value: FixedAssetStatus) => (
        <Tag color={ASSET_STATUS[value].color}>{ASSET_STATUS[value].label}</Tag>
      ),
    },
    {
      title: "Cost",
      dataIndex: "cost_minor",
      width: COLUMN.MONEY,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Accum. dep.",
      dataIndex: "accumulated_depreciation_minor",
      width: COLUMN.MONEY,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Net book value",
      dataIndex: "net_book_value_minor",
      width: COLUMN.MONEY,
      align: "right",
      render: (value: number) => <Typography.Text strong>{money(value)}</Typography.Text>,
    },
    {
      title: "Disposal result",
      dataIndex: "disposal_gain_loss_minor",
      width: 140,
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
      // The elastic column, with the category under the name.
      ...flexColumn<AssetDepreciationDetail>({
        title: "Asset",
        key: "asset",
        render: (_value: unknown, row: AssetDepreciationDetail) => (
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong title={`${row.asset_number} · ${row.asset_name}`}>
              {row.asset_number} · {row.asset_name}
            </Typography.Text>
            {secondaryLine(row.category)}
          </div>
        ),
      }),
    },
    { title: "Period end", dataIndex: "period_end", width: COLUMN.DATE, render: (v: string) => formatDate(v) },
    {
      title: "Planned",
      dataIndex: "planned_amount_minor",
      width: COLUMN.MONEY,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Recognized",
      dataIndex: "posted_amount_minor",
      width: COLUMN.MONEY,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: COLUMN.STATUS,
      render: (value: string) => {
        const config = SCHEDULE_STATUS[value] ?? { label: value, color: "default" };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "Journal entry",
      dataIndex: "journal_entry_id",
      width: 130,
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

      <ReportBar
        ariaLabel="Fixed asset report filters"
        resultCount={rowCount}
        dates={{
          kind: "range",
          preset: draft.preset,
          from: draft.from,
          to: draft.to,
          onPreset: (key) => {
            if (key === "custom") {
              setDraft((previous) => ({ ...previous, preset: "custom" }));
              return;
            }
            const next = { preset: key, ...presetRange(key, presets) };
            setDraft(next);
            setApplied(next);
          },
          onFrom: (d) => setDraft((previous) => ({ ...previous, preset: "custom", from: d })),
          onTo: (d) => setDraft((previous) => ({ ...previous, preset: "custom", to: d })),
        }}
        filters={
          <>
            <Select
              aria-label="Category"
              value={category}
              onChange={setCategory}
              style={{ width: 240 }}
              options={[
                { value: "all", label: "All categories" },
                ...categories.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              aria-label="Asset status"
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
          </>
        }
        onRun={() => setApplied(draft)}
        loading={false}
        sheet={rowCount > 0 ? exportSheet : null}
      />

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
            pagination={clientTablePagination(
              assetsPageSize,
              setAssetsPageSize,
              pageSizeOptionsFor(ASSET_REGISTER_DEFAULT_PAGE_SIZE),
            )}
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
                  valueStyle={{ color: depreciationTotals.unposted > 0 ? TOKENS.intent.warning : undefined }}
                />
              </Card>
            </Col>
          </Row>
          <DataTable
            rowKey="id"
            columns={depreciationColumns}
            dataSource={filteredDepreciation}
            pagination={clientTablePagination(
              depreciationPageSize,
              setDepreciationPageSize,
              pageSizeOptionsFor(DEPRECIATION_DEFAULT_PAGE_SIZE),
            )}
            emptyTitle="No depreciation rows match the report filters"
          />
        </>
      )}
    </Space>
  );
}
