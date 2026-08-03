import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAV,
  NEW_MENU,
  SETTINGS_HUB,
  ALLOWED_REPORT_DEEP_LINKS,
  isNavGroup,
  navLeaves,
  findActivePage,
  navigationForAccess,
  findActiveGroup,
  searchKindLabel,
} from "@/lib/domain/navigation";
import {
  INTERNAL_REPORT_HREFS,
  REPORT_CATALOG,
} from "@/lib/domain/report-catalog";

/** Every route the app actually serves, read from the filesystem. */
function appRoutes(): string[] {
  const root = join(process.cwd(), "app", "(app)");
  const routes: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${entry}`);
      } else if (entry === "page.tsx") {
        routes.push(prefix === "" ? "/" : prefix);
      }
    }
  };
  walk(root, "");
  return routes;
}

const ROUTES = appRoutes();

describe("app route inventory", () => {
  it("finds the routes the navigation is built from", () => {
    expect(ROUTES).toContain("/dashboard");
    expect(ROUTES).toContain("/invoices");
    expect(ROUTES.length).toBeGreaterThan(30);
  });
});

describe("report links", () => {
  it("points every report catalog entry at a route that exists", () => {
    const missing = REPORT_CATALOG
      .map((report) => report.href.split("?")[0])
      .filter((path) => !ROUTES.includes(path));

    expect(missing).toEqual([]);
  });

  it("keeps internal financial statement links aligned with the Report Center", () => {
    for (const report of REPORT_CATALOG) {
      if (!report.internalReport) continue;
      expect(report.href).toBe(INTERNAL_REPORT_HREFS[report.internalReport]);
    }
  });
});

describe("NAV tree", () => {
  const leaves = navLeaves(NAV);

  it("keeps the sidebar short — at most 8 top-level entries", () => {
    expect(NAV.length).toBeLessThanOrEqual(8);
  });

  it("points every leaf at a route that exists", () => {
    const missing = leaves.map((l) => l.key).filter((key) => !ROUTES.includes(key));
    expect(missing).toEqual([]);
  });

  it("lists no route twice", () => {
    const keys = leaves.map((l) => l.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("keeps detailed reports out of the primary sidebar", () => {
    const reportLeaves = leaves.map((l) => l.key).filter((key) => key.startsWith("/reports/"));
    expect(reportLeaves).toEqual([]);
    expect(ALLOWED_REPORT_DEEP_LINKS).toEqual([]);
  });

  it("keeps inventory valuation in the report catalog", () => {
    expect(REPORT_CATALOG.some((r) => r.href === "/reports/inventory-valuation")).toBe(true);
  });

  it("sends Reports and Settings to their hub pages, not to leaves", () => {
    const keys = NAV.filter((item) => !isNavGroup(item)).map((item) => item.key);
    expect(keys).toContain("/reports");
    expect(keys).toContain("/settings");
  });

  it("does not put Approvals in the sidebar (it lives in the top bar)", () => {
    expect(navLeaves(NAV).some((l) => l.key === "/approvals")).toBe(false);
  });

  it("gives every group at least two children", () => {
    for (const item of NAV) {
      if (isNavGroup(item)) expect(item.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("follows the accounting work areas and their expected order", () => {
    expect(NAV.map((item) => item.key)).toEqual([
      "/dashboard",
      "sales",
      "purchases",
      "banking",
      "inventory-assets",
      "accounting",
      "/reports",
      "/settings",
    ]);
    const sales = NAV.find((item) => item.key === "sales");
    const inventory = NAV.find((item) => item.key === "inventory-assets");
    expect(isNavGroup(sales!) ? sales.children.map((item) => item.key) : []).toEqual([
      "/sales",
      "/customers",
      "/items",
      "/invoices",
      "/payments",
      "/credit-memos",
      "/sales-tax",
    ]);
    expect(isNavGroup(inventory!) ? inventory.children.map((item) => item.key) : []).toEqual([
      "/inventory",
      "/fixed-assets",
    ]);
  });

  it("gives every route exactly one home in the sidebar", () => {
    // findActiveGroup returns the first group containing a route, so a leaf
    // listed twice makes sidebar highlighting depend on declaration order.
    const keys = navLeaves().map((page) => page.key);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it("files the product catalog under Sales", () => {
    expect(findActiveGroup("/items")).toBe("sales");
  });

  it("starts every operational group with its overview", () => {
    const expected: Record<string, string> = {
      sales: "/sales",
      purchases: "/purchases",
      banking: "/banking/overview",
      "inventory-assets": "/inventory",
      accounting: "/accounting",
    };
    for (const [groupKey, overviewHref] of Object.entries(expected)) {
      const group = NAV.find((item) => item.key === groupKey);
      expect(isNavGroup(group!) ? group.children[0]?.key : undefined).toBe(overviewHref);
    }
  });
});

describe("navigationForAccess", () => {
  it("shows settings when the role has a relevant permission", () => {
    const items = navigationForAccess({
      role: "viewer",
      permissionKeys: ["audit.read"],
    });
    expect(items.some((item) => item.key === "/settings")).toBe(true);
  });

  it("hides settings when the resolved permission set has no settings access", () => {
    const items = navigationForAccess({
      role: "viewer",
      permissionKeys: [],
    });
    expect(items.some((item) => item.key === "/settings")).toBe(false);
  });

  it("fails open for navigation when permission lookup is unavailable", () => {
    const items = navigationForAccess({
      role: "accountant",
      permissionKeys: null,
    });
    expect(items.some((item) => item.key === "/settings")).toBe(true);
  });
});

describe("findActivePage", () => {
  it("matches an exact route", () => {
    expect(findActivePage("/invoices")?.key).toBe("/invoices");
  });

  it("matches a detail route to its list entry", () => {
    expect(findActivePage("/purchase-orders/abc-123")?.key).toBe("/purchase-orders");
  });

  it("prefers the longest matching route", () => {
    expect(findActivePage("/banking/reconcile/abc")?.key).toBe("/banking/reconcile");
  });

  it("matches every detailed report to the Report Center entry", () => {
    expect(findActivePage("/reports/inventory-valuation")?.key).toBe("/reports");
  });

  it("falls back to the Reports hub for a report with no sidebar entry", () => {
    expect(findActivePage("/reports/ap-aging")?.key).toBe("/reports");
  });

  it("returns null for something outside the navigation", () => {
    expect(findActivePage("/nowhere")).toBeNull();
  });
});

describe("SETTINGS_HUB", () => {
  const hubHrefs = SETTINGS_HUB.flatMap((g) => g.items.map((i) => i.href));

  it("covers every settings route the app serves", () => {
    const settingsRoutes = ROUTES.filter((r) => r.startsWith("/settings/"));
    const missing = settingsRoutes.filter((r) => !hubHrefs.includes(r));
    expect(missing).toEqual([]);
  });

  it("points every card at a route that exists", () => {
    const missing = hubHrefs.filter((href) => !ROUTES.includes(href));
    expect(missing).toEqual([]);
  });

  it("gives every card a description, so the hub explains itself", () => {
    for (const group of SETTINGS_HUB) {
      for (const item of group.items) {
        expect(item.description.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("NEW_MENU", () => {
  it("targets an existing route with the new-form flag", () => {
    for (const item of NEW_MENU) {
      const [route, query] = item.href.split("?");
      expect(ROUTES).toContain(route);
      expect(query).toBe("new=1");
    }
  });

  it("covers the documents entered daily", () => {
    expect(NEW_MENU.map((i) => i.key)).toEqual([
      "invoice",
      "payment",
      "bill",
      "expense",
      "purchase-order",
      "journal",
    ]);
  });
});

describe("searchKindLabel", () => {
  it("labels every kind the search returns", () => {
    expect(searchKindLabel("invoice")).toBe("Invoice");
    expect(searchKindLabel("bill_payment")).toBe("Bill payment");
    expect(searchKindLabel("purchase_order")).toBe("Purchase order");
    expect(searchKindLabel("customer")).toBe("Customer");
    expect(searchKindLabel("item")).toBe("Product or service");
  });

  it("falls back to the raw kind rather than throwing", () => {
    expect(searchKindLabel("something_new")).toBe("something new");
  });
});
