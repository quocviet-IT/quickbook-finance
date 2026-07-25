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
  searchKindLabel,
} from "@/lib/domain/navigation";
import { REPORT_CATALOG } from "@/lib/domain/report-catalog";

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

  it("does not duplicate the Report Center, apart from the deliberate deep links", () => {
    const reportLeaves = leaves.map((l) => l.key).filter((key) => key.startsWith("/reports/"));
    expect(reportLeaves.sort()).toEqual([...ALLOWED_REPORT_DEEP_LINKS].sort());
  });

  it("keeps every allowed deep link in the report catalog, so a rename cannot rot it", () => {
    for (const href of ALLOWED_REPORT_DEEP_LINKS) {
      expect(REPORT_CATALOG.some((r) => r.href === href)).toBe(true);
    }
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

  it("matches a report deep link to the report entry", () => {
    expect(findActivePage("/reports/inventory-valuation")?.key).toBe("/reports/inventory-valuation");
  });

  it("falls back to the Reports hub for a report with no sidebar entry", () => {
    expect(findActivePage("/reports/ap-ageing")?.key).toBe("/reports");
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
