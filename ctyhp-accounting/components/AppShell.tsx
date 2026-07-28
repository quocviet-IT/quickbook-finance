"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
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
  LeftOutlined,
  RightOutlined,
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
  findActiveGroup,
  findActivePage,
  isNavGroup,
  navigationForAccess,
  type NavItem,
} from "@/lib/domain/navigation";
import GlobalSearch from "./GlobalSearch";
import NewMenu from "./NewMenu";

const { Header, Sider, Content } = Layout;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "ctyhp-accounting:sidebar-collapsed";
const SIDEBAR_GROUP_STORAGE_KEY = "ctyhp-accounting:sidebar-open-group";
const SIDEBAR_STORAGE_EVENT = "ctyhp-accounting:storage";

/**
 * Icons live here rather than in the nav data, so `lib/domain/navigation.ts`
 * stays plain data that a unit test can check against the app's routes.
 */
const NAV_ICONS: Record<string, ReactNode> = {
  "/dashboard": <DashboardOutlined />,
  sales: <ShoppingOutlined />,
  purchases: <ShopOutlined />,
  "inventory-assets": <GoldOutlined />,
  banking: <BankOutlined />,
  accounting: <TableOutlined />,
  "/reports": <BarChartOutlined />,
  "/settings": <SettingOutlined />,
};

function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(SIDEBAR_STORAGE_EVENT, { detail: key }));
  } catch {
    // Private browsing or a restrictive policy may disable storage.
  }
}

function useStoredValue(key: string, serverValue = ""): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === key) onStoreChange();
      };
      const handleLocalStorage = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) onStoreChange();
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener(SIDEBAR_STORAGE_EVENT, handleLocalStorage);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(SIDEBAR_STORAGE_EVENT, handleLocalStorage);
      };
    },
    () => readStoredValue(key) ?? serverValue,
    () => serverValue,
  );
}

interface StoredOpenGroup {
  key: string;
  pathname: string;
}

function parseStoredOpenGroup(value: string): StoredOpenGroup | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredOpenGroup>;
    return typeof parsed.key === "string" && typeof parsed.pathname === "string"
      ? { key: parsed.key, pathname: parsed.pathname }
      : null;
  } catch {
    return null;
  }
}

function NavigationMenu({
  items,
  pathname,
  activePageKey,
  activeGroupKey,
  collapsed,
  storageKey,
  className,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  activePageKey: string;
  activeGroupKey?: string;
  collapsed: boolean;
  storageKey?: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const rootGroupKeys = useMemo(
    () => items.filter(isNavGroup).map((item) => item.key),
    [items],
  );
  const storedOpenGroup = parseStoredOpenGroup(
    useStoredValue(storageKey ?? `${SIDEBAR_GROUP_STORAGE_KEY}:disabled`),
  );
  const storedKeyIsValid = storedOpenGroup
    ? rootGroupKeys.includes(storedOpenGroup.key)
    : false;
  const openKey =
    storedKeyIsValid && storedOpenGroup?.pathname === pathname
      ? storedOpenGroup.key
      : activeGroupKey && rootGroupKeys.includes(activeGroupKey)
        ? activeGroupKey
        : storedKeyIsValid
          ? storedOpenGroup?.key
          : undefined;
  const openKeys = openKey ? [openKey] : [];

  function handleOpenChange(nextOpenKeys: string[]) {
    const latestKey = nextOpenKeys.find((key) => key !== openKey);
    if (latestKey && rootGroupKeys.includes(latestKey)) {
      if (storageKey) {
        storeValue(storageKey, JSON.stringify({ key: latestKey, pathname }));
      }
      return;
    }
    const validKeys = nextOpenKeys.filter((key) => rootGroupKeys.includes(key));
    if (storageKey) {
      storeValue(storageKey, JSON.stringify({ key: validKeys[0] ?? "", pathname }));
    }
  }

  const toMenuItem = (item: NavItem) =>
    isNavGroup(item)
      ? {
          key: item.key,
          icon: NAV_ICONS[item.key],
          label: item.label,
          title: item.label,
          children: item.children.map((child) => ({
            key: child.key,
            label: (
              <Link
                href={child.key}
                onClick={() => {
                  if (storageKey) {
                    storeValue(
                      storageKey,
                      JSON.stringify({ key: item.key, pathname: child.key }),
                    );
                  }
                }}
              >
                {child.label}
              </Link>
            ),
            title: child.label,
          })),
        }
      : {
          key: item.key,
          icon: NAV_ICONS[item.key],
          label: <Link href={item.key}>{item.label}</Link>,
          title: item.label,
        };

  return (
    <Menu
      aria-label="Primary navigation"
      className={className}
      theme="dark"
      mode="inline"
      inlineIndent={18}
      selectedKeys={[activePageKey]}
      openKeys={collapsed ? undefined : openKeys}
      onOpenChange={handleOpenChange}
      onClick={onNavigate}
      items={items.map(toMenuItem)}
    />
  );
}

export default function AppShell({
  email,
  role,
  permissionKeys,
  pendingApprovals,
  children,
}: {
  email: string;
  role: AppRole | null;
  /** Null means the permission lookup failed; menu filtering then degrades open. */
  permissionKeys: string[] | null;
  /** Badge count, so the approvals queue is visible without a sidebar slot. */
  pendingApprovals: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const collapsed =
    useStoredValue(SIDEBAR_COLLAPSED_STORAGE_KEY, "false") === "true";
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const visibleNavigation = useMemo(
    () => navigationForAccess({ role, permissionKeys }),
    [permissionKeys, role],
  );
  const primaryNavigation = useMemo(
    () => visibleNavigation.filter((item) => item.key !== "/settings"),
    [visibleNavigation],
  );
  const utilityNavigation = useMemo(
    () => visibleNavigation.filter((item) => item.key === "/settings"),
    [visibleNavigation],
  );

  const activePage = findActivePage(pathname);
  const activePageKey = activePage?.key ?? "";
  const activeGroupKey = activePage ? findActiveGroup(activePage.key) : undefined;
  async function signOut() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  function handleCollapse(nextCollapsed: boolean) {
    storeValue(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed));
  }

  const canCreate = role === "admin" || role === "accountant";
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
          collapsedWidth={72}
          trigger={null}
          theme="dark"
          width={248}
          className="app-shell__sider"
        >
          <div className="app-shell__sidebar-frame">
            <Brand collapsed={collapsed} />
            <div className="app-shell__navigation-scroll">
              <NavigationMenu
                items={primaryNavigation}
                pathname={pathname}
                activePageKey={activePageKey}
                activeGroupKey={activeGroupKey}
                collapsed={collapsed}
                storageKey={SIDEBAR_GROUP_STORAGE_KEY}
                className="app-shell__navigation-menu"
              />
            </div>
            <div className="app-shell__sidebar-footer">
              {utilityNavigation.length > 0 && (
                <NavigationMenu
                  items={utilityNavigation}
                  pathname={pathname}
                  activePageKey={activePageKey}
                  collapsed={collapsed}
                  className="app-shell__navigation-menu app-shell__utility-menu"
                />
              )}
              <Tooltip title={collapsed ? "Expand navigation" : ""} placement="right">
                <Button
                  type="text"
                  icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
                  aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
                  aria-expanded={!collapsed}
                  onClick={() => handleCollapse(!collapsed)}
                  className="app-shell__collapse-button"
                >
                  {!collapsed && <span>Collapse navigation</span>}
                </Button>
              </Tooltip>
            </div>
          </div>
        </Sider>
      )}

      <Drawer
        title={<Brand collapsed={false} />}
        placement="left"
        open={isMobile && mobileNavigationOpen}
        onClose={() => setMobileNavigationOpen(false)}
        width={304}
        className="app-shell__mobile-drawer"
      >
        <div className="app-shell__sidebar-frame app-shell__sidebar-frame--mobile">
          <div className="app-shell__navigation-scroll">
            <NavigationMenu
              items={primaryNavigation}
              pathname={pathname}
              activePageKey={activePageKey}
              activeGroupKey={activeGroupKey}
              collapsed={false}
              storageKey={SIDEBAR_GROUP_STORAGE_KEY}
              className="app-shell__navigation-menu"
              onNavigate={() => setMobileNavigationOpen(false)}
            />
          </div>
          <div className="app-shell__sidebar-footer">
            <ApprovalsLink
              pendingApprovals={pendingApprovals}
              active={pathname.startsWith("/approvals")}
              navigation
              onNavigate={() => setMobileNavigationOpen(false)}
            />
            {utilityNavigation.length > 0 && (
              <NavigationMenu
                items={utilityNavigation}
                pathname={pathname}
                activePageKey={activePageKey}
                collapsed={false}
                className="app-shell__navigation-menu app-shell__utility-menu"
                onNavigate={() => setMobileNavigationOpen(false)}
              />
            )}
          </div>
        </div>
      </Drawer>

      <Layout className="app-shell__workspace">
        <Header className="app-shell__header">
          {isMobile && (
            <div className="app-shell__header-start">
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
            </div>
          )}

          <div className="app-shell__header-search">
            <GlobalSearch />
          </div>

          <div className="app-shell__header-end">
            {canCreate && <NewMenu />}
            <ApprovalsLink
              pendingApprovals={pendingApprovals}
              active={pathname.startsWith("/approvals")}
              compact={isMobile}
            />
            <Dropdown menu={accountMenu} placement="bottomRight" trigger={["click"]}>
              <Button
                type="text"
                aria-label={`Open account menu for ${email}`}
                className="app-shell__account-button"
              >
                <Avatar
                  size={32}
                  icon={<UserOutlined />}
                  className="app-shell__account-avatar"
                />
                {!isMobile && (
                  <span className="app-shell__account-identity" aria-hidden="true">
                    <span className="app-shell__account-email">{email}</span>
                    {role && <span className="app-shell__account-role">{role}</span>}
                  </span>
                )}
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
    <Link
      href="/dashboard"
      aria-label="CTYHP Accounting dashboard"
      className={`app-shell__brand${collapsed ? " app-shell__brand--collapsed" : ""}`}
    >
      <span className="app-shell__brand-mark" aria-hidden="true">
        CT
      </span>
      {!collapsed && (
        <span className="app-shell__brand-copy">
          <Typography.Text strong className="app-shell__brand-name">
            CTYHP Accounting
          </Typography.Text>
          <span className="app-shell__brand-subtitle">Jewelry operations</span>
        </span>
      )}
    </Link>
  );
}

function ApprovalsLink({
  pendingApprovals,
  active,
  compact = false,
  navigation = false,
  onNavigate,
}: {
  pendingApprovals: number;
  active: boolean;
  compact?: boolean;
  navigation?: boolean;
  onNavigate?: () => void;
}) {
  const title =
    pendingApprovals > 0
      ? `Approvals, ${pendingApprovals} waiting for a decision`
      : "Approvals, nothing waiting";

  return (
    <Tooltip title={compact ? title : ""}>
      <Link
        href="/approvals"
        aria-label={title}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={[
          "app-shell__approvals",
          compact ? "app-shell__approvals--compact" : "",
          navigation ? "app-shell__approvals--navigation" : "",
          active ? "app-shell__approvals--active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SafetyCertificateOutlined className="app-shell__approvals-icon" />
        {!compact && <span className="app-shell__approvals-label">Approvals</span>}
        <Badge
          count={pendingApprovals}
          showZero
          overflowCount={99}
          size="small"
          className={[
            "app-shell__approvals-count",
            pendingApprovals === 0 ? "app-shell__approvals-count--clear" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </Link>
    </Tooltip>
  );
}
