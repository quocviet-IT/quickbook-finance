"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BankOutlined,
  BarChartOutlined,
  TableOutlined,
  LogoutOutlined,
  DashboardOutlined,
  ShopOutlined,
  ShoppingOutlined,
  SettingOutlined,
  MenuOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { AppRole } from "@/lib/db/types";

const { Header, Sider, Content } = Layout;

type NavPage = {
  key: string;
  label: string;
  icon?: ReactNode;
};

type NavGroup = {
  key: string;
  label: string;
  icon: ReactNode;
  children: NavPage[];
};

type NavItem = NavPage | NavGroup;

const NAV: NavItem[] = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  {
    key: "sales",
    icon: <ShoppingOutlined />,
    label: "Sales & Customers",
    children: [
      { key: "/items", label: "Jewelry Catalog" },
      { key: "/customers", label: "Customers" },
      { key: "/invoices", label: "Invoices" },
      { key: "/credit-memos", label: "Credit Memos" },
      { key: "/payments", label: "Payments" },
    ],
  },
  {
    key: "purchases",
    icon: <ShopOutlined />,
    label: "Purchases & Vendors",
    children: [
      { key: "/vendors", label: "Vendors" },
      { key: "/bills", label: "Bills" },
      { key: "/vendor-credits", label: "Vendor Credits" },
      { key: "/expenses", label: "Expenses" },
      { key: "/pay-bills", label: "Pay Bills" },
    ],
  },
  {
    key: "banking",
    icon: <BankOutlined />,
    label: "Banking",
    children: [
      { key: "/banking", label: "Bank Transactions" },
      { key: "/banking/reconcile", label: "Reconcile" },
    ],
  },
  {
    key: "accounting",
    icon: <TableOutlined />,
    label: "Accounting",
    children: [
      { key: "/accounts", label: "Chart of Accounts" },
      { key: "/journal", label: "Journal Entries" },
      { key: "/sales-tax", label: "Sales Tax" },
    ],
  },
  {
    key: "reports",
    icon: <BarChartOutlined />,
    label: "Reports",
    children: [
      { key: "/reports", label: "Report Center" },
      { key: "/reports/general-ledger", label: "General Ledger" },
      { key: "/reports/journal", label: "Journal Report" },
      { key: "/reports/ar-ageing", label: "Accounts Receivable Ageing" },
      { key: "/reports/customer-statement", label: "Customer Statements" },
      { key: "/reports/ap-ageing", label: "Accounts Payable Ageing" },
      { key: "/reports/vendor-statement", label: "Vendor Statements" },
      { key: "/reports/cash-flow", label: "Cash Flow" },
    ],
  },
  {
    key: "settings",
    icon: <SettingOutlined />,
    label: "Settings",
    children: [
      { key: "/settings/company", label: "Company" },
      { key: "/settings/periods", label: "Accounting Periods" },
      { key: "/opening-balances", label: "Opening Balances" },
    ],
  },
];

function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

const NAV_PAGES = NAV.flatMap((item) => (isNavGroup(item) ? item.children : [item]));
const ROOT_GROUP_KEYS = NAV.filter(isNavGroup).map((item) => item.key);

function findActivePage(pathname: string): NavPage {
  return (
    NAV_PAGES.filter(
      (page) => pathname === page.key || pathname.startsWith(`${page.key}/`),
    ).sort((a, b) => b.key.length - a.key.length)[0] ?? NAV_PAGES[0]
  );
}

function findActiveGroup(pageKey: string): string | undefined {
  return NAV.find(
    (item): item is NavGroup =>
      isNavGroup(item) && item.children.some((child) => child.key === pageKey),
  )?.key;
}

function NavigationMenu({
  activePageKey,
  activeGroupKey,
  collapsed,
  onNavigate,
}: {
  activePageKey: string;
  activeGroupKey?: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [openKeys, setOpenKeys] = useState<string[]>(
    activeGroupKey ? [activeGroupKey] : [],
  );

  function handleOpenChange(nextOpenKeys: string[]) {
    const latestKey = nextOpenKeys.find((key) => !openKeys.includes(key));

    if (latestKey && ROOT_GROUP_KEYS.includes(latestKey)) {
      setOpenKeys([latestKey]);
      return;
    }

    setOpenKeys(nextOpenKeys.filter((key) => ROOT_GROUP_KEYS.includes(key)));
  }

  return (
    <Menu
      aria-label="Primary navigation"
      theme="dark"
      mode="inline"
      selectedKeys={[activePageKey]}
      openKeys={collapsed ? undefined : openKeys}
      onOpenChange={handleOpenChange}
      onClick={onNavigate}
      items={NAV.map((item) =>
        isNavGroup(item)
          ? {
              key: item.key,
              icon: item.icon,
              label: item.label,
              children: item.children.map((child) => ({
                key: child.key,
                label: <Link href={child.key}>{child.label}</Link>,
              })),
            }
          : {
              key: item.key,
              icon: item.icon,
              label: <Link href={item.key}>{item.label}</Link>,
            },
      )}
    />
  );
}

export default function AppShell({
  email,
  role,
  children,
}: {
  email: string;
  role: AppRole | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const activePage = findActivePage(pathname);
  const activeGroupKey = findActiveGroup(activePage.key);

  async function signOut() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  const roleColor = role === "admin" ? "gold" : role === "accountant" ? "blue" : "default";
  const accountMenu = {
    items: [
      {
        key: "identity",
        label: (
          <div className="app-shell__account-summary">
            <Typography.Text strong>{email}</Typography.Text>
            {role && <Typography.Text type="secondary">{role}</Typography.Text>}
          </div>
        ),
        disabled: true,
      },
      { type: "divider" as const },
      {
        key: "sign-out",
        icon: <LogoutOutlined />,
        label: "Sign out",
        danger: true,
        onClick: signOut,
      },
    ],
  };

  return (
    <Layout className="app-shell">
      <a className="accounting-skip-link" href="#main-content">
        Skip to main content
      </a>

      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="dark"
          width={232}
          className="app-shell__sider"
        >
          <Brand collapsed={collapsed} />
          <NavigationMenu
            key={activeGroupKey ?? activePage.key}
            activePageKey={activePage.key}
            activeGroupKey={activeGroupKey}
            collapsed={collapsed}
          />
        </Sider>
      )}

      <Drawer
        title={<Brand collapsed={false} />}
        placement="left"
        open={isMobile && mobileNavigationOpen}
        onClose={() => setMobileNavigationOpen(false)}
        width={300}
        className="app-shell__mobile-drawer"
        styles={{
          header: { background: "#0f172a", borderBottomColor: "#1e293b" },
          body: { padding: 0, background: "#0f172a" },
        }}
      >
        <NavigationMenu
          key={`mobile-${activeGroupKey ?? activePage.key}`}
          activePageKey={activePage.key}
          activeGroupKey={activeGroupKey}
          collapsed={false}
          onNavigate={() => setMobileNavigationOpen(false)}
        />
      </Drawer>

      <Layout className="app-shell__workspace">
        <Header className="app-shell__header">
          <div className="app-shell__header-start">
            {isMobile && (
              <Tooltip title="Open navigation">
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  aria-label="Open navigation"
                  aria-expanded={mobileNavigationOpen}
                  onClick={() => setMobileNavigationOpen(true)}
                  className="app-shell__menu-button"
                />
              </Tooltip>
            )}
            <Typography.Text className="app-shell__route-title">{activePage.label}</Typography.Text>
          </div>

          {isMobile ? (
            <Dropdown menu={accountMenu} placement="bottomRight" trigger={["click"]}>
              <Button
                type="text"
                aria-label="Open account menu"
                className="app-shell__account-button"
              >
                <Avatar size={32} icon={<UserOutlined />} />
              </Button>
            </Dropdown>
          ) : (
            <Space size="middle">
              <Typography.Text type="secondary" className="app-shell__email">
                {email}
              </Typography.Text>
              {role && (
                <Tag color={roleColor} className="app-shell__role">
                  {role}
                </Tag>
              )}
              <Button icon={<LogoutOutlined />} onClick={signOut}>
                Sign out
              </Button>
            </Space>
          )}
        </Header>
        <Content id="main-content" tabIndex={-1} className="app-shell__content">
          <div className="app-shell__content-inner">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`app-shell__brand${collapsed ? " app-shell__brand--collapsed" : ""}`}>
      <span className="app-shell__brand-mark" aria-hidden="true">
        CT
      </span>
      {!collapsed && (
        <Typography.Text strong className="app-shell__brand-name">
          CTYHP Accounting
        </Typography.Text>
      )}
    </div>
  );
}
