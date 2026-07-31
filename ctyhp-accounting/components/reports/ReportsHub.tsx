"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  LineChartOutlined,
  PercentageOutlined,
  PieChartOutlined,
  SearchOutlined,
  ShopOutlined,
  StarFilled,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Card, Input, Select, Tabs, Typography } from "antd";
import {
  REPORT_CATALOG,
  REPORT_GROUPS,
  type ReportDefinition,
  type ReportGroupId,
} from "@/lib/domain/report-catalog";
import {
  getFavoriteReportIds,
  getRecentReportIds,
  recordRecentReport,
  toggleFavoriteReport,
} from "@/lib/client/report-preferences";

const REPORT_ICONS: Record<string, ReactNode> = {
  "profit-and-loss": <BarChartOutlined />,
  "balance-sheet": <PieChartOutlined />,
  "cash-flow": <LineChartOutlined />,
  "statement-of-equity": <FileDoneOutlined />,
  "budget-vs-actual": <BarChartOutlined />,
  "accounts-receivable-aging": <TeamOutlined />,
  "customer-statements": <FileTextOutlined />,
  "accounts-payable-aging": <ShopOutlined />,
  "vendor-statements": <FileTextOutlined />,
  "1099-review": <FileSearchOutlined />,
  "trial-balance": <AuditOutlined />,
  "general-ledger": <BankOutlined />,
  "journal-report": <FileTextOutlined />,
  "inventory-valuation": <ShopOutlined />,
  "sales-tax": <PercentageOutlined />,
};

function reportsFromIds(ids: string[]) {
  return ids
    .map((id) => REPORT_CATALOG.find((report) => report.id === id))
    .filter((report): report is ReportDefinition => Boolean(report));
}

function ReportCard({
  report,
  favorite,
  onFavorite,
  onOpen,
}: {
  report: ReportDefinition;
  favorite: boolean;
  onFavorite: (reportId: string) => void;
  onOpen: (reportId: string) => void;
}) {
  return (
    <Card className="report-hub-card" bordered>
      <div className="report-hub-card__top">
        <span className="report-hub-card__icon" aria-hidden="true">
          {REPORT_ICONS[report.id] ?? <FileTextOutlined />}
        </span>
        <Button
          className="report-hub-card__favorite"
          type="text"
          icon={favorite ? <StarFilled /> : <StarOutlined />}
          aria-label={`${favorite ? "Remove" : "Add"} ${report.title} ${
            favorite ? "from" : "to"
          } favorites`}
          aria-pressed={favorite}
          onClick={() => onFavorite(report.id)}
        />
      </div>
      <Typography.Title level={4} className="report-hub-card__title">
        <Link href={report.href} onClick={() => onOpen(report.id)}>
          {report.title}
        </Link>
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="report-hub-card__description">
        {report.description}
      </Typography.Paragraph>
      <Link
        href={report.href}
        className="report-hub-card__open"
        onClick={() => onOpen(report.id)}
      >
        Open report <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}

export default function ReportsHub() {
  const [activeGroup, setActiveGroup] = useState<ReportGroupId>("business-overview");
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    // Browser preferences are restored after hydration because localStorage is client-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavoriteIds(getFavoriteReportIds());
    setRecentIds(getRecentReportIds());
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleReports = useMemo(() => {
    if (!normalizedQuery) {
      return REPORT_CATALOG.filter((report) => report.group === activeGroup);
    }

    return REPORT_CATALOG.filter((report) => {
      const group = REPORT_GROUPS.find((item) => item.id === report.group);
      return [report.title, report.description, group?.label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [activeGroup, normalizedQuery]);

  const favoriteReports = reportsFromIds(favoriteIds);
  const recentReports = reportsFromIds(recentIds).filter(
    (report) => !favoriteIds.includes(report.id),
  );
  const currentGroup = REPORT_GROUPS.find((group) => group.id === activeGroup)!;

  function handleFavorite(reportId: string) {
    setFavoriteIds(toggleFavoriteReport(reportId));
  }

  function handleOpen(reportId: string) {
    setRecentIds(recordRecentReport(reportId));
  }

  function renderCards(reports: ReportDefinition[]) {
    return (
      <div className="report-hub-grid">
        {reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            favorite={favoriteIds.includes(report.id)}
            onFavorite={handleFavorite}
            onOpen={handleOpen}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="reports-hub">
      <div className="reports-hub__toolbar">
        <div>
          <Typography.Title level={3}>Find the right report</Typography.Title>
          <Typography.Text type="secondary">
            Browse by workflow or search all available reports.
          </Typography.Text>
        </div>
        <Input
          className="reports-hub__search"
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder="Search reports"
          aria-label="Search reports"
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {!normalizedQuery && favoriteReports.length > 0 && (
        <section className="reports-hub__section" aria-labelledby="favorite-reports">
          <div className="reports-hub__section-heading">
            <StarFilled aria-hidden="true" />
            <Typography.Title level={3} id="favorite-reports">
              Favorites
            </Typography.Title>
          </div>
          {renderCards(favoriteReports)}
        </section>
      )}

      {!normalizedQuery && recentReports.length > 0 && (
        <section className="reports-hub__section" aria-labelledby="recent-reports">
          <div className="reports-hub__section-heading">
            <ClockCircleOutlined aria-hidden="true" />
            <Typography.Title level={3} id="recent-reports">
              Recently viewed
            </Typography.Title>
          </div>
          {renderCards(recentReports)}
        </section>
      )}

      <section className="reports-hub__section" aria-labelledby="report-category">
        {normalizedQuery ? (
          <div className="reports-hub__category-heading">
            <Typography.Title level={3} id="report-category">
              Search results
            </Typography.Title>
            <Typography.Text type="secondary">
              {visibleReports.length} {visibleReports.length === 1 ? "report" : "reports"} found
            </Typography.Text>
          </div>
        ) : (
          <>
            <Tabs
              className="reports-hub__desktop-tabs"
              activeKey={activeGroup}
              onChange={(key) => setActiveGroup(key as ReportGroupId)}
              items={REPORT_GROUPS.map((group) => ({
                key: group.id,
                label: group.label,
              }))}
            />
            <div className="reports-hub__mobile-category">
              <label htmlFor="report-category-select">Report category</label>
              <Select
                id="report-category-select"
                aria-label="Report category"
                value={activeGroup}
                onChange={(value) => setActiveGroup(value)}
                options={REPORT_GROUPS.map((group) => ({
                  value: group.id,
                  label: group.label,
                }))}
              />
            </div>
            <div className="reports-hub__category-heading">
              <div>
                <Typography.Title level={3} id="report-category">
                  {currentGroup.label}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {currentGroup.description}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary">
                Select the star to pin a frequently used report.
              </Typography.Text>
            </div>
          </>
        )}

        {visibleReports.length > 0 ? (
          renderCards(visibleReports)
        ) : (
          <div className="reports-hub__empty">
            <FileSearchOutlined aria-hidden="true" />
            <Typography.Title level={4}>No reports found</Typography.Title>
            <Typography.Text type="secondary">
              Try another report name or category.
            </Typography.Text>
          </div>
        )}
      </section>
    </div>
  );
}
