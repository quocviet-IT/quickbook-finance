export type WorkAreaId =
  | "sales"
  | "purchases"
  | "banking"
  | "inventory"
  | "accounting";

export type OverviewTone = "positive" | "warning" | "negative" | "neutral";
export type OverviewValueType = "money" | "number" | "percent";
export type OverviewIcon =
  | "receivable"
  | "overdue"
  | "sales"
  | "cash"
  | "payable"
  | "purchase-order"
  | "bank"
  | "review"
  | "connection"
  | "inventory"
  | "quantity"
  | "asset"
  | "ledger"
  | "period"
  | "approval";

export interface WorkAreaMetric {
  key: string;
  label: string;
  value: number;
  valueType: OverviewValueType;
  caption: string;
  href: string;
  tone: OverviewTone;
  icon: OverviewIcon;
}

export interface WorkAreaTrendPoint {
  key: string;
  label: string;
  primary: number;
  secondary: number;
}

export interface WorkAreaTrend {
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  valueType: "money" | "number";
  points: WorkAreaTrendPoint[];
}

export interface WorkAreaStage {
  key: string;
  label: string;
  count: number;
  valueMinor?: number;
  href: string;
  tone: OverviewTone;
}

export interface WorkAreaException {
  key: string;
  title: string;
  detail: string;
  count: number;
  valueMinor?: number;
  href: string;
  severity: "high" | "medium" | "low";
}

export interface WorkAreaActivity {
  key: string;
  title: string;
  detail: string;
  occurredOn: string;
  valueMinor?: number;
  href: string;
  status?: string;
}

export interface WorkAreaLink {
  key: string;
  label: string;
  description: string;
  href: string;
}

export interface WorkAreaControl {
  title: string;
  detail: string;
  href: string;
  status: "healthy" | "attention" | "neutral";
}

export interface WorkAreaOverviewData {
  area: WorkAreaId;
  title: string;
  description: string;
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  primaryAction?: {
    label: string;
    href: string;
  };
  metrics: WorkAreaMetric[];
  trend: WorkAreaTrend;
  stages: WorkAreaStage[];
  exceptions: WorkAreaException[];
  activities: WorkAreaActivity[];
  links: WorkAreaLink[];
  control: WorkAreaControl;
}

export interface MonthWindow {
  key: string;
  label: string;
  from: string;
  to: string;
}

export function monthStart(asOf: string): string {
  return `${asOf.slice(0, 7)}-01`;
}

export function trailingMonthWindows(asOf: string, count = 6): MonthWindow[] {
  const year = Number(asOf.slice(0, 4));
  const monthIndex = Number(asOf.slice(5, 7)) - 1;

  return Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const start = new Date(Date.UTC(year, monthIndex - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const key = start.toISOString().slice(0, 7);
    const monthEnd = end.toISOString().slice(0, 10);
    return {
      key,
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      from: `${key}-01`,
      to: key === asOf.slice(0, 7) ? asOf : monthEnd,
    };
  });
}

export function within(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export function overdueAmount(buckets: Record<string, number>): number {
  return Object.entries(buckets)
    .filter(([key]) => key !== "current")
    .reduce((sum, [, value]) => sum + Number(value), 0);
}
