"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightOutlined,
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FilterOutlined,
  GoldOutlined,
  InboxOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  TeamOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Card, Empty, Segmented, Select, Tag, Typography } from "antd";
import PageHeader from "@/components/PageHeader";
import { fromMinor } from "@/lib/domain/money";
import type {
  OverviewIcon,
  OverviewTone,
  WorkAreaBreakdown,
  WorkAreaBreakdownPoint,
  WorkAreaOverviewData,
  WorkAreaTrend,
} from "@/lib/domain/work-area-overview";
import styles from "./WorkAreaOverview.module.css";

const ICONS: Record<OverviewIcon, ReactNode> = {
  receivable: <TeamOutlined />,
  overdue: <ClockCircleOutlined />,
  sales: <FileTextOutlined />,
  cash: <DollarOutlined />,
  payable: <FileDoneOutlined />,
  "purchase-order": <ShoppingCartOutlined />,
  bank: <BankOutlined />,
  review: <InboxOutlined />,
  connection: <SwapOutlined />,
  inventory: <GoldOutlined />,
  quantity: <ShopOutlined />,
  asset: <SafetyCertificateOutlined />,
  ledger: <AuditOutlined />,
  period: <CalendarOutlined />,
  approval: <CheckCircleOutlined />,
};

type AnalysisRange = 3 | 6 | 12;
type TrendSeries = "both" | "primary" | "secondary";

export default function WorkAreaOverview({ data }: { data: WorkAreaOverviewData }) {
  const [range, setRange] = useState<AnalysisRange>(6);
  const [series, setSeries] = useState<TrendSeries>("both");
  const money = (minor: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: data.currencyCode,
      minimumFractionDigits: data.currencyDecimals,
      maximumFractionDigits: data.currencyDecimals,
    }).format(fromMinor(minor, data.currencyDecimals));
  const number = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  const formatValue = (value: number, type: "money" | "number" | "percent") => {
    if (type === "money") return money(value);
    if (type === "percent") return `${number(value)}%`;
    return number(value);
  };
  const activeExceptions = data.exceptions.filter((exception) => exception.count > 0);
  const visibleTrend: WorkAreaTrend = {
    ...data.trend,
    points: data.trend.points.slice(-range),
  };
  const activityFrom = visibleTrend.points[0]?.key ?? data.asOf.slice(0, 7);
  const visibleActivities = data.activities.filter(
    (activity) => activity.occurredOn.slice(0, 7) >= activityFrom,
  );

  return (
    <div className={`${styles.root} ${styles[data.area]}`}>
      <PageHeader
        title={data.title}
        description={data.description}
        meta={
          <div className={styles.context}>
            <Tag>As of {data.asOf}</Tag>
            <Tag>{data.currencyCode}</Tag>
            <Tag>Operational overview</Tag>
          </div>
        }
        actions={
          data.primaryAction ? (
            <Link href={data.primaryAction.href} className={styles.primaryAction}>
              <PlusOutlined aria-hidden="true" />
              {data.primaryAction.label}
            </Link>
          ) : undefined
        }
      />

      <section className={styles.filterBar} aria-label="Overview analysis filters">
        <div className={styles.filterSummary}>
          <span className={styles.filterIcon} aria-hidden="true">
            <FilterOutlined />
          </span>
          <span>
            <strong>Analysis controls</strong>
            <small>
              Trend and activity follow the selected window. Balance charts remain as
              of {data.asOf}.
            </small>
          </span>
        </div>
        <div className={styles.filterControls}>
          <label className={styles.filterControl}>
            <span>Trend window</span>
            <Segmented
              aria-label="Trend window"
              options={[
                { label: "3M", value: 3 },
                { label: "6M", value: 6 },
                { label: "12M", value: 12 },
              ]}
              value={range}
              onChange={(value) => setRange(value as AnalysisRange)}
            />
          </label>
          <label className={styles.filterControl}>
            <span>Series</span>
            <Select
              aria-label="Visible trend series"
              value={series}
              onChange={(value) => setSeries(value)}
              options={[
                { label: "Both series", value: "both" },
                { label: data.trend.primaryLabel, value: "primary" },
                { label: data.trend.secondaryLabel, value: "secondary" },
              ]}
            />
          </label>
        </div>
        <span className="accounting-sr-only" aria-live="polite">
          Showing {range} months with{" "}
          {series === "both"
            ? "both trend series"
            : series === "primary"
              ? data.trend.primaryLabel
              : data.trend.secondaryLabel}
          .
        </span>
      </section>

      <section aria-labelledby={`${data.area}-metrics`}>
        <h2 id={`${data.area}-metrics`} className="accounting-sr-only">
          Key metrics
        </h2>
        <div className={styles.metricGrid}>
          {data.metrics.map((metric) => (
            <Link
              href={metric.href}
              key={metric.key}
              className={`${styles.metric} ${toneClass(metric.tone)}`}
              aria-label={`${metric.label}: ${formatValue(metric.value, metric.valueType)}. ${metric.caption}`}
            >
              <span className={styles.metricTop}>
                <span className={styles.metricLabel}>{metric.label}</span>
                <span className={styles.metricIcon} aria-hidden="true">
                  {ICONS[metric.icon]}
                </span>
              </span>
              <strong className={styles.metricValue}>
                {formatValue(metric.value, metric.valueType)}
              </strong>
              <span className={styles.metricCaption}>
                {metric.caption}
                <ArrowRightOutlined aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className={styles.mainGrid}>
        <Card className={styles.panel} title={data.trend.title}>
          <Typography.Paragraph type="secondary" className={styles.panelDescription}>
            {data.trend.description} Showing {range} months.
          </Typography.Paragraph>
          <TrendChart
            trend={visibleTrend}
            series={series}
            formatValue={(value) => formatValue(value, data.trend.valueType)}
          />
        </Card>

        <Card
          className={styles.panel}
          title="Attention queue"
          extra={
            <Typography.Text type="secondary">
              {activeExceptions.length} active
            </Typography.Text>
          }
        >
          {activeExceptions.length === 0 ? (
            <div className={styles.clearState}>
              <CheckCircleOutlined aria-hidden="true" />
              <div>
                <Typography.Text strong>No current exceptions</Typography.Text>
                <Typography.Paragraph type="secondary">
                  The control and operational queues for this area are clear.
                </Typography.Paragraph>
              </div>
            </div>
          ) : (
            <div className={styles.exceptionList}>
              {activeExceptions.map((exception) => (
                <Link
                  href={exception.href}
                  className={styles.exception}
                  data-severity={exception.severity}
                  key={exception.key}
                >
                  <span className={styles.exceptionIcon} aria-hidden="true">
                    {exception.severity === "high" ? (
                      <WarningOutlined />
                    ) : (
                      <ClockCircleOutlined />
                    )}
                  </span>
                  <span className={styles.exceptionBody}>
                    <strong>{exception.title}</strong>
                    <small>{exception.detail}</small>
                  </span>
                  <span className={styles.exceptionValue}>
                    <strong>{number(exception.count)}</strong>
                    {exception.valueMinor !== undefined && (
                      <small>{money(exception.valueMinor)}</small>
                    )}
                  </span>
                  <ArrowRightOutlined aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <section className={styles.analysisGrid} aria-label={`${data.title} analysis charts`}>
        {data.breakdowns.map((breakdown) => (
          <Card className={styles.panel} title={breakdown.title} key={breakdown.key}>
            <Typography.Paragraph type="secondary" className={styles.panelDescription}>
              {breakdown.description}
            </Typography.Paragraph>
            <BreakdownChart
              breakdown={breakdown}
              formatValue={(value) => formatValue(value, breakdown.valueType)}
            />
          </Card>
        ))}
      </section>

      <div className={styles.secondaryGrid}>
        <Card className={styles.panel} title="Workflow position">
          <div className={styles.stageList}>
            {data.stages.map((stage) => (
              <Link href={stage.href} className={styles.stage} key={stage.key}>
                <span className={`${styles.stageIndicator} ${toneClass(stage.tone)}`} />
                <span className={styles.stageBody}>
                  <span>{stage.label}</span>
                  <small>{number(stage.count)} records</small>
                </span>
                {stage.valueMinor !== undefined && (
                  <strong>{money(stage.valueMinor)}</strong>
                )}
                <ArrowRightOutlined aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Card>

        <Card className={styles.panel} title="Recent activity">
          {visibleActivities.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`No activity is available in the selected ${range}-month window.`}
            />
          ) : (
            <div className={styles.activityList}>
              {visibleActivities.map((activity) => (
                <Link href={activity.href} className={styles.activity} key={activity.key}>
                  <span className={styles.activityDate}>
                    {shortDate(activity.occurredOn)}
                  </span>
                  <span className={styles.activityBody}>
                    <strong>{activity.title}</strong>
                    <small>{activity.detail}</small>
                  </span>
                  <span className={styles.activityValue}>
                    {activity.valueMinor !== undefined && (
                      <strong>{money(activity.valueMinor)}</strong>
                    )}
                    {activity.status && <small>{activity.status}</small>}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <section
        className={`${styles.control} ${styles[`control-${data.control.status}`]}`}
        aria-label={data.control.title}
      >
        <span className={styles.controlIcon} aria-hidden="true">
          {data.control.status === "healthy" ? (
            <CheckCircleOutlined />
          ) : data.control.status === "attention" ? (
            <WarningOutlined />
          ) : (
            <SafetyCertificateOutlined />
          )}
        </span>
        <span className={styles.controlBody}>
          <strong>{data.control.title}</strong>
          <span>{data.control.detail}</span>
        </span>
        <Link href={data.control.href}>
          Review control <ArrowRightOutlined />
        </Link>
      </section>

      <section aria-labelledby={`${data.area}-work-area-links`}>
        <div className={styles.sectionHeading}>
          <div>
            <Typography.Title level={4} id={`${data.area}-work-area-links`}>
              Work area
            </Typography.Title>
            <Typography.Text type="secondary">
              Open the detailed workflow without losing the overview context.
            </Typography.Text>
          </div>
        </div>
        <div className={styles.linkGrid}>
          {data.links.map((link) => (
            <Link href={link.href} className={styles.workLink} key={link.key}>
              <span>
                <strong>{link.label}</strong>
                <small>{link.description}</small>
              </span>
              <ArrowRightOutlined aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendChart({
  trend,
  series,
  formatValue,
}: {
  trend: WorkAreaTrend;
  series: TrendSeries;
  formatValue: (value: number) => string;
}) {
  const showPrimary = series !== "secondary";
  const showSecondary = series !== "primary";
  const values = trend.points.flatMap((point) => [
    ...(showPrimary ? [point.primary] : []),
    ...(showSecondary ? [point.secondary] : []),
  ]);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const hasData = values.some((value) => value !== 0);

  if (!hasData) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Post activity to build the selected trend."
      />
    );
  }

  return (
    <>
      <div className={styles.legend} aria-hidden="true">
        {showPrimary && (
          <span><i className={styles.primarySwatch} />{trend.primaryLabel}</span>
        )}
        {showSecondary && (
          <span><i className={styles.secondarySwatch} />{trend.secondaryLabel}</span>
        )}
      </div>
      <div
        className={styles.trendChart}
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, trend.points.length)}, minmax(46px, 1fr))`,
        }}
        role="img"
        aria-label={`${trend.title}: ${showPrimary ? trend.primaryLabel : ""}${showPrimary && showSecondary ? " compared with " : ""}${showSecondary ? trend.secondaryLabel : ""} over ${trend.points.length} months`}
      >
        {trend.points.map((point) => (
          <div className={styles.trendGroup} key={point.key}>
            <div className={styles.trendPlot}>
              {showPrimary && (
                <span
                  className={styles.primaryBar}
                  style={{ height: `${Math.max(point.primary ? 4 : 0, (Math.abs(point.primary) / max) * 100)}%` }}
                  title={`${point.label} ${trend.primaryLabel}: ${formatValue(point.primary)}`}
                  aria-label={`${point.label} ${trend.primaryLabel}: ${formatValue(point.primary)}`}
                  tabIndex={0}
                />
              )}
              {showSecondary && (
                <span
                  className={styles.secondaryBar}
                  style={{ height: `${Math.max(point.secondary ? 4 : 0, (Math.abs(point.secondary) / max) * 100)}%` }}
                  title={`${point.label} ${trend.secondaryLabel}: ${formatValue(point.secondary)}`}
                  aria-label={`${point.label} ${trend.secondaryLabel}: ${formatValue(point.secondary)}`}
                  tabIndex={0}
                />
              )}
            </div>
            <span className={styles.trendLabel}>{point.label}</span>
          </div>
        ))}
      </div>
      <table className="accounting-sr-only">
        <caption>{trend.title}</caption>
        <thead>
          <tr>
            <th>Month</th>
            {showPrimary && <th>{trend.primaryLabel}</th>}
            {showSecondary && <th>{trend.secondaryLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {trend.points.map((point) => (
            <tr key={point.key}>
              <th>{point.label}</th>
              {showPrimary && <td>{formatValue(point.primary)}</td>}
              {showSecondary && <td>{formatValue(point.secondary)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BreakdownChart({
  breakdown,
  formatValue,
}: {
  breakdown: WorkAreaBreakdown;
  formatValue: (value: number) => string;
}) {
  const max = Math.max(
    1,
    ...breakdown.points.map((point) => Math.abs(point.value)),
  );
  const hasData = breakdown.points.some((point) => point.value !== 0);

  if (!hasData) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No values are available at the reporting date."
      />
    );
  }

  return (
    <>
      <div className={styles.breakdownChart}>
        {breakdown.points.map((point) => (
          <BreakdownRow
            point={point}
            max={max}
            formatValue={formatValue}
            key={point.key}
          />
        ))}
      </div>
      <table className="accounting-sr-only">
        <caption>{breakdown.title}</caption>
        <thead>
          <tr>
            <th>Category</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.points.map((point) => (
            <tr key={point.key}>
              <th>{point.label}</th>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BreakdownRow({
  point,
  max,
  formatValue,
}: {
  point: WorkAreaBreakdownPoint;
  max: number;
  formatValue: (value: number) => string;
}) {
  const content = (
    <>
      <span className={styles.breakdownHeader}>
        <span>{point.label}</span>
        <strong>{formatValue(point.value)}</strong>
      </span>
      <span className={styles.breakdownTrack} aria-hidden="true">
        <span
          className={`${styles.breakdownFill} ${toneClass(point.tone ?? "neutral")}`}
          style={{
            width: `${Math.max(point.value ? 2 : 0, (Math.abs(point.value) / max) * 100)}%`,
          }}
        />
      </span>
    </>
  );
  const label = `${point.label}: ${formatValue(point.value)}`;

  return point.href ? (
    <Link href={point.href} className={styles.breakdownRow} aria-label={label}>
      {content}
      <ArrowRightOutlined aria-hidden="true" />
    </Link>
  ) : (
    <div className={styles.breakdownRow} role="img" aria-label={label}>
      {content}
    </div>
  );
}

function toneClass(tone: OverviewTone): string {
  return styles[`tone-${tone}`];
}

function shortDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
