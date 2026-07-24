"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Typography, Button, Tag, Space } from "antd";
import {
  BankOutlined,
  BarChartOutlined,
  TableOutlined,
  LogoutOutlined,
  DashboardOutlined,
  ShopOutlined,
  ShoppingOutlined,
  SettingOutlined,
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
}: {
  activePageKey: string;
  activeGroupKey?: string;
  collapsed: boolean;
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
  const [collapsed, setCollapsed] = useState(false);

  const activePage = findActivePage(pathname);
  const activeGroupKey = findActiveGroup(activePage.key);

  async function signOut() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  const roleColor = role === "admin" ? "gold" : role === "accountant" ? "blue" : "default";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={220}>
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: collapsed ? 0 : "0 20px",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "#0f766e",
              color: "#fff",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            CT
          </span>
          {!collapsed && (
            <Typography.Text strong style={{ color: "#f8fafc", fontSize: 15 }}>
              CTYHP Accounting
            </Typography.Text>
          )}
        </div>
        <NavigationMenu
          key={activeGroupKey ?? activePage.key}
          activePageKey={activePage.key}
          activeGroupKey={activeGroupKey}
          collapsed={collapsed}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #eef2f6",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 13, letterSpacing: 0.2 }}>
            {activePage.label}
          </Typography.Text>
          <Space size="middle">
            <Typography.Text type="secondary">{email}</Typography.Text>
            {role && <Tag color={roleColor} style={{ textTransform: "capitalize", marginInlineEnd: 0 }}>{role}</Tag>}
            <Button icon={<LogoutOutlined />} onClick={signOut}>
              Sign out
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24 }}>
          <div style={{ maxWidth: 1280, margin: "0 auto" }}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
