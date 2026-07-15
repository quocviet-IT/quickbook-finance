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
} from "@ant-design/icons";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { AppRole } from "@/lib/db/types";

const { Header, Sider, Content } = Layout;

const NAV = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Bảng điều khiển" },
  { key: "/accounts", icon: <TableOutlined />, label: "Hệ thống tài khoản" },
  { key: "/invoices", icon: <FileTextOutlined />, label: "Hóa đơn" },
  { key: "/payments", icon: <DollarOutlined />, label: "Thanh toán" },
  { key: "/banking", icon: <BankOutlined />, label: "Ngân hàng" },
  { key: "/reports", icon: <BarChartOutlined />, label: "Báo cáo" },
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

  const selectedKey = NAV.find((n) => pathname.startsWith(n.key))?.key ?? "/dashboard";

  async function signOut() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography.Text strong style={{ color: "#fff", fontSize: collapsed ? 14 : 16 }}>
            {collapsed ? "CT" : "CTYHP Kế toán"}
          </Typography.Text>
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
            background: "#fff",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Space>
            <Typography.Text type="secondary">{email}</Typography.Text>
            {role && <Tag color={role === "admin" ? "gold" : role === "accountant" ? "blue" : "default"}>{role}</Tag>}
            <Button icon={<LogoutOutlined />} onClick={signOut}>
              Đăng xuất
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 20 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
