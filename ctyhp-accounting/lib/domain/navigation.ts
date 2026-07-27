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

export interface NavPage {
  key: string;
  label: string;
}

export interface NavGroup {
  key: string;
  label: string;
  children: NavPage[];
}

export type NavItem = NavPage | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

/**
 * Reports live in the Report Center. These two are the deliberate exceptions:
 * stock value is a daily question in a jewelry business, so it is reachable
 * where the catalog is, not only from the report index.
 */
export const ALLOWED_REPORT_DEEP_LINKS = ["/reports/inventory-valuation"] as const;

export const NAV: NavItem[] = [
  { key: "/dashboard", label: "Dashboard" },
  {
    key: "sales",
    label: "Sales",
    children: [
      { key: "/invoices", label: "Invoices" },
      { key: "/payments", label: "Payments" },
      { key: "/credit-memos", label: "Credit Memos" },
      { key: "/customers", label: "Customers" },
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    children: [
      { key: "/bills", label: "Bills" },
      { key: "/expenses", label: "Expenses" },
      { key: "/purchase-orders", label: "Purchase Orders" },
      { key: "/pay-bills", label: "Pay Bills" },
      { key: "/vendor-credits", label: "Vendor Credits" },
      { key: "/vendors", label: "Vendors" },
    ],
  },
  {
    key: "products",
    label: "Products",
    children: [
      { key: "/items", label: "Products & Services" },
      { key: "/reports/inventory-valuation", label: "Inventory Valuation" },
    ],
  },
  {
    key: "banking",
    label: "Banking",
    children: [
      { key: "/banking", label: "Bank Transactions" },
      { key: "/banking/reconcile", label: "Reconcile" },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    children: [
      { key: "/accounts", label: "Chart of Accounts" },
      { key: "/journal", label: "Journal Entries" },
      { key: "/fixed-assets", label: "Fixed Assets" },
      { key: "/sales-tax", label: "Sales Tax" },
      { key: "/opening-balances", label: "Opening Balances" },
    ],
  },
  { key: "/reports", label: "Reports" },
  { key: "/settings", label: "Settings" },
];

export function navLeaves(items: NavItem[] = NAV): NavPage[] {
  return items.flatMap((item) => (isNavGroup(item) ? item.children : [item]));
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
        href: "/settings/periods",
        title: "Accounting periods",
        description: "Open and close monthly periods, and reopen one with a reason.",
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
