import {
  BankOutlined,
  BarChartOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GoldOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TableOutlined,
} from "@ant-design/icons";
import type { AbacusIconKind } from "./abacus-view";

/**
 * The icon for a part of OneBook: the one the sidebar shows beside it
 * (components/AppShell.tsx), so a screen looks the same in the panel as in
 * the menu. A screen no menu holds gets a page.
 */
const ICONS: Readonly<Record<AbacusIconKind, typeof FileTextOutlined>> = {
  dashboard: DashboardOutlined,
  sales: ShoppingOutlined,
  purchases: ShopOutlined,
  inventory: GoldOutlined,
  banking: BankOutlined,
  accounting: TableOutlined,
  reports: BarChartOutlined,
  settings: SettingOutlined,
  guide: BookOutlined,
  data: DatabaseOutlined,
  controls: SafetyCertificateOutlined,
  other: FileTextOutlined,
};

/** Decorative: the words beside it name the screen. */
export default function ScreenIcon({ kind, className }: { kind: AbacusIconKind; className?: string }) {
  const Icon = ICONS[kind] ?? FileTextOutlined;
  return (
    <span className={className} aria-hidden="true">
      <Icon aria-hidden="true" />
    </span>
  );
}
