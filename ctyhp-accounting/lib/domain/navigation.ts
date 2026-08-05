/**
 * The application's information architecture, kept out of the shell component so
 * it can be tested: the sidebar tree, the settings hub catalog, the create menu,
 * and the labels the global search groups its results by.
 *
 * Structure follows the money flow the way established accounting products do —
 * a contact lives in the group where you work with them, not in a separate
 * address book — and configuration lives behind one Settings entry instead of a
 * sidebar leaf per screen.
 */
import type { AppRole } from "@/lib/db/types";

export interface NavPage {
  key: string;
  label: string;
  /** Optional presentation gate. Server authorization remains authoritative. */
  roles?: AppRole[];
  /** Show when the user holds at least one permission in this list. */
  anyPermissions?: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  children: NavPage[];
  roles?: AppRole[];
  anyPermissions?: string[];
}

export type NavItem = NavPage | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

/** Detailed reports live in the Report Center rather than the primary sidebar. */
export const ALLOWED_REPORT_DEEP_LINKS: readonly string[] = [];

export const NAV: NavItem[] = [
  { key: "/dashboard", label: "Dashboard" },
  {
    key: "sales",
    label: "Sales",
    children: [
      { key: "/sales", label: "Overview" },
      { key: "/customers", label: "Customers" },
      // The catalog belongs where prices are set on documents, not with the
      // stock it happens to also describe.
      { key: "/items", label: "Products & Services" },
      { key: "/invoices", label: "Invoices" },
      { key: "/payments", label: "Payments" },
      { key: "/credit-memos", label: "Credit Memos" },
      { key: "/sales-tax", label: "Sales Tax" },
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    children: [
      { key: "/purchases", label: "Overview" },
      { key: "/vendors", label: "Vendors" },
      { key: "/purchase-orders", label: "Purchase Orders" },
      { key: "/bills", label: "Bills" },
      { key: "/pay-bills", label: "Pay Bills" },
      { key: "/expenses", label: "Expenses" },
      { key: "/vendor-credits", label: "Vendor Credits" },
    ],
  },
  {
    key: "banking",
    label: "Banking",
    children: [
      { key: "/banking/overview", label: "Overview" },
      { key: "/banking", label: "Bank Transactions" },
      { key: "/banking/reconcile", label: "Reconcile" },
    ],
  },
  {
    key: "inventory-assets",
    label: "Inventory & Assets",
    children: [
      { key: "/inventory", label: "Overview" },
      { key: "/fixed-assets", label: "Fixed Assets" },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    children: [
      { key: "/accounting", label: "Overview" },
      { key: "/accounts", label: "Chart of Accounts" },
      { key: "/journal", label: "Journal Entries" },
      { key: "/recurring", label: "Recurring Transactions" },
      { key: "/opening-balances", label: "Opening Balances" },
    ],
  },
  { key: "/reports", label: "Reports" },
  {
    key: "/settings",
    label: "Settings",
    anyPermissions: [
      "settings.manage",
      "users.manage",
      "permissions.manage",
      "audit.read",
      "period.close",
      "period.reopen",
    ],
  },
];

export function navLeaves(items: NavItem[] = NAV): NavPage[] {
  return items.flatMap((item) => (isNavGroup(item) ? item.children : [item]));
}

export interface NavigationAccess {
  role: AppRole | null;
  /**
   * Null means the permission lookup was unavailable, so the menu degrades
   * without hiding valid destinations. Authorization is still checked server-side.
   */
  permissionKeys: readonly string[] | null;
}

function canShowNavItem(
  item: Pick<NavItem, "roles" | "anyPermissions">,
  access: NavigationAccess,
): boolean {
  const permissionKeys = access.permissionKeys;
  if (item.roles && (!access.role || !item.roles.includes(access.role))) return false;
  if (
    item.anyPermissions?.length &&
    permissionKeys !== null &&
    !item.anyPermissions.some((key) => permissionKeys.includes(key))
  ) {
    return false;
  }
  return true;
}

/**
 * Presentation-only navigation filtering. It reduces clutter for limited users;
 * every destination and mutation keeps its existing server/RLS authorization.
 */
export function navigationForAccess(
  access: NavigationAccess,
  items: NavItem[] = NAV,
): NavItem[] {
  return items.flatMap((item) => {
    if (!canShowNavItem(item, access)) return [];
    if (!isNavGroup(item)) return [item];
    const children = item.children.filter((child) => canShowNavItem(child, access));
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

/**
 * The sidebar entry a path belongs to: the longest matching route wins, so
 * `/banking/reconcile/abc` selects Reconcile rather than Bank Transactions, and
 * a report with no entry of its own falls back to the Reports hub.
 */
export function findActivePage(pathname: string, items: NavItem[] = NAV): NavPage | null {
  const matches = navLeaves(items).filter(
    (page) => pathname === page.key || pathname.startsWith(`${page.key}/`),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.key.length - a.key.length)[0];
}

export function findActiveGroup(pageKey: string, items: NavItem[] = NAV): string | undefined {
  return items.find(
    (item): item is NavGroup => isNavGroup(item) && item.children.some((c) => c.key === pageKey),
  )?.key;
}

// --- Settings hub -----------------------------------------------------------

export interface SettingsHubItem {
  href: string;
  title: string;
  description: string;
}

export interface SettingsHubGroup {
  id: string;
  label: string;
  items: SettingsHubItem[];
}

export const SETTINGS_HUB: SettingsHubGroup[] = [
  {
    id: "company",
    label: "Company",
    items: [
      {
        href: "/settings/company",
        title: "Company profile",
        description: "Legal name, addresses, fiscal year, base currency, and accounting basis.",
      },
      {
        href: "/settings/companies",
        title: "Companies",
        description: "Every set of books this system holds, and how to start another one.",
      },
      {
        href: "/settings/periods",
        title: "Accounting periods",
        description: "Open and close monthly periods, and reopen one with a reason.",
      },
      {
        href: "/settings/import",
        title: "Import from QuickBooks or Wave",
        description:
          "Bring a chart of accounts, contacts, products and opening balances across from a CSV export.",
      },
    ],
  },
  {
    id: "control",
    label: "People and control",
    items: [
      {
        href: "/settings/users",
        title: "Users",
        description: "Create login accounts, set roles, suspend or offboard access, and check MFA.",
      },
      {
        href: "/settings/permissions",
        title: "Permissions",
        description: "What each role may do, and which permissions the server enforces.",
      },
      {
        href: "/settings/approvals",
        title: "Approval policies",
        description: "Which actions need a second person, above what amount, and segregation.",
      },
      {
        href: "/settings/audit",
        title: "Audit history",
        description: "Who changed what, when, and the before and after values.",
      },
      {
        href: "/settings/feedback",
        title: "Feedback triage",
        description: "Bug reports and suggestions filed by staff, with screenshots.",
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    items: [
      {
        href: "/settings/purchasing",
        title: "Purchasing tolerances",
        description: "Price and quantity tolerances for three-way matching on a bill.",
      },
    ],
  },
];

// --- Create menu ------------------------------------------------------------

export interface NewMenuItem {
  key: string;
  label: string;
  href: string;
}

/**
 * The create forms are modals on their list pages, so the menu navigates with
 * `?new=1` and the page opens its own modal. Nothing is duplicated.
 */
export const NEW_MENU: NewMenuItem[] = [
  { key: "invoice", label: "Invoice", href: "/invoices?new=1" },
  { key: "payment", label: "Payment received", href: "/payments?new=1" },
  { key: "bill", label: "Bill", href: "/bills?new=1" },
  { key: "expense", label: "Expense", href: "/expenses?new=1" },
  { key: "purchase-order", label: "Purchase order", href: "/purchase-orders?new=1" },
  { key: "journal", label: "Journal entry", href: "/journal?new=1" },
];

// --- Global search ----------------------------------------------------------

const SEARCH_KIND_LABELS: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  purchase_order: "Purchase order",
  expense: "Expense",
  payment: "Payment",
  bill_payment: "Bill payment",
  customer: "Customer",
  vendor: "Vendor",
  item: "Product or service",
};

/** Human label for a search result kind; unknown kinds degrade rather than throw. */
export function searchKindLabel(kind: string): string {
  return SEARCH_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}
