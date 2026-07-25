"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
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
  GoldOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ShoppingOutlined,
  SettingOutlined,
  MenuOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { AppRole } from "@/lib/db/types";
import {
  NAV,
  findActiveGroup,
  findActivePage,
  isNavGroup,
  type NavItem,
} from "@/lib/domain/navigation";
import GlobalSearch from "./GlobalSearch";
import NewMenu from "./NewMenu";

const { Header, Sider, Content } = Layout;

/**
 * Icons live here rather than in the nav data, so `lib/domain/navigation.ts`
 * stays plain data that a unit test can check against the app's routes.
 */
const NAV_ICONS: Record<string, ReactNode> = {
  "/dashboard": <DashboardOutlined />,
  sales: <ShoppingOutlined />,
  purchases: <ShopOutlined />,
  products: <GoldOutlined />,
  banking: <BankOutlined />,
  accounting: <TableOutlined />,
  "/reports": <BarChartOutlined />,
  "/settings": <SettingOutlined />,
};

const ROOT_GROUP_KEYS = NAV.filter(isNavGroup).map((item) => item.key);

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
  const [openKeys, setOpenKeys] = useState<string[]>(activeGroupKey ? [activeGroupKey] : []);

  function handleOpenChange(nextOpenKeys: string[]) {
    const latestKey = nextOpenKeys.find((key) => !openKeys.includes(key));
    if (latestKey && ROOT_GROUP_KEYS.includes(latestKey)) {
      setOpenKeys([latestKey]);
      return;
    }
    setOpenKeys(nextOpenKeys.filter((key) => ROOT_GROUP_KEYS.includes(key)));
  }

  const toMenuItem = (item: NavItem) =>
    isNavGroup(item)
      ? {
          key: item.key,
          icon: NAV_ICONS[item.key],
          label: item.label,
          children: item.children.map((child) => ({
            key: child.key,
            label: <Link href={child.key}>{child.label}</Link>,
          })),
        }
      : {
          key: item.key,
          icon: NAV_ICONS[item.key],
          label: <Link href={item.key}>{item.label}</Link>,
        };

  return (
    <Menu
      aria-label="Primary navigation"
      theme="dark"
      mode="inline"
      selectedKeys={[activePageKey]}
      openKeys={collapsed ? undefined : openKeys}
      onOpenChange={handleOpenChange}
      onClick={onNavigate}
      items={NAV.map(toMenuItem)}
    />
  );
}

export default function AppShell({
  email,
  role,
  pendingApprovals,
  children,
}: {
  email: string;
  role: AppRole | null;
  /** Badge count, so the approvals queue is visible without a sidebar slot. */
  pendingApprovals: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const activePage = findActivePage(pathname);
  const activePageKey = activePage?.key ?? "";
  const activeGroupKey = activePage ? findActiveGroup(activePage.key) : undefined;
  // Routes outside the sidebar (Approvals) still deserve a title.
  const routeTitle = activePage?.label ?? (pathname.startsWith("/approvals") ? "Approvals" : "");

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
          width={224}
          className="app-shell__sider"
        >
          <Brand collapsed={collapsed} />
          <NavigationMenu
            key={activeGroupKey ?? activePageKey}
            activePageKey={activePageKey}
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
        width={288}
        className="app-shell__mobile-drawer"
        styles={{
          header: { background: "#0f172a", borderBottomColor: "#1e293b" },
          body: { padding: 0, background: "#0f172a" },
        }}
      >
        <NavigationMenu
          key={`mobile-${activeGroupKey ?? activePageKey}`}
          activePageKey={activePageKey}
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
            <Typography.Text className="app-shell__route-title">{routeTitle}</Typography.Text>
          </div>

          <div className="app-shell__header-search">
            <GlobalSearch />
          </div>

          <div className="app-shell__header-end">
            <NewMenu />
            <Tooltip
              title={pendingApprovals > 0 ? `${pendingApprovals} waiting for a decision` : "Approvals"}
            >
              <Link href="/approvals" className="app-shell__approvals" aria-label="Approvals">
                <Badge count={pendingApprovals} size="small" offset={[2, -2]}>
                  <SafetyCertificateOutlined className="app-shell__approvals-icon" />
                </Badge>
              </Link>
            </Tooltip>
            {!isMobile && (
              <>
                <Typography.Text type="secondary" className="app-shell__email">
                  {email}
                </Typography.Text>
                {role && (
                  <Tag color={roleColor} className="app-shell__role">
                    {role}
                  </Tag>
                )}
              </>
            )}
            <Dropdown menu={accountMenu} placement="bottomRight" trigger={["click"]}>
              <Button type="text" aria-label="Open account menu" className="app-shell__account-button">
                <Avatar size={30} icon={<UserOutlined />} />
              </Button>
            </Dropdown>
          </div>
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
