"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Typography, Button, Tag, Space } from "antd";
import {
  BankOutlined,
  FileTextOutlined,
  DollarOutlined,
  BarChartOutlined,
  TableOutlined,
  LogoutOutlined,
  DashboardOutlined,
  TeamOutlined,
  ShopOutlined,
  CreditCardOutlined,
  ShoppingOutlined,
  PercentageOutlined,
} from "@ant-design/icons";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { AppRole } from "@/lib/db/types";

const { Header, Sider, Content } = Layout;

const NAV = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/accounts", icon: <TableOutlined />, label: "Chart of Accounts" },
  { key: "/items", icon: <ShoppingOutlined />, label: "Products & Services" },
  { key: "/customers", icon: <TeamOutlined />, label: "Customers" },
  { key: "/invoices", icon: <FileTextOutlined />, label: "Invoices" },
  { key: "/credit-memos", icon: <FileTextOutlined />, label: "Credit Memos" },
  { key: "/payments", icon: <DollarOutlined />, label: "Payments" },
  { key: "/vendors", icon: <ShopOutlined />, label: "Vendors" },
  { key: "/bills", icon: <FileTextOutlined />, label: "Bills" },
  { key: "/vendor-credits", icon: <FileTextOutlined />, label: "Vendor Credits" },
  { key: "/expenses", icon: <CreditCardOutlined />, label: "Expenses" },
  { key: "/pay-bills", icon: <DollarOutlined />, label: "Pay Bills" },
  { key: "/banking", icon: <BankOutlined />, label: "Banking" },
  { key: "/reports", icon: <BarChartOutlined />, label: "Reports" },
  { key: "/sales-tax", icon: <PercentageOutlined />, label: "Sales Tax" },
  { key: "/journal", icon: <FileTextOutlined />, label: "Journal Entries" },
  { key: "/opening-balances", icon: <TableOutlined />, label: "Opening Balances" },
];

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

  const active = NAV.find((n) => pathname.startsWith(n.key));
  const selectedKey = active?.key ?? "/dashboard";

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
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV.map((n) => ({
            key: n.key,
            icon: n.icon,
            label: <Link href={n.key}>{n.label}</Link>,
          }))}
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
            {active?.label ?? "CTYHP Accounting"}
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
