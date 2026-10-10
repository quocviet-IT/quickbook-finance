import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/domain/navigation";
import { CHANGE_LOG_PERMISSIONS, REPORT_CATALOG, canOpenReport } from "@/lib/domain/report-catalog";

const WAVE_1 = [
  ["open-invoices", "Open Invoices", "/reports/open-invoices", "receivables"],
  ["customer-balances", "Customer Balances", "/reports/customer-balances", "receivables"],
  ["sales-by-customer", "Sales by Customer", "/reports/sales-by-customer", "receivables"],
  ["unpaid-bills", "Unpaid Bills", "/reports/unpaid-bills", "payables"],
  ["vendor-balances", "Vendor Balances", "/reports/vendor-balances", "payables"],
  ["expenses-by-vendor", "Expenses by Vendor", "/reports/expenses-by-vendor", "payables"],
  ["reconciliation-report", "Reconciliation Report", "/reports/reconciliations", "accounting"],
  ["change-log", "Change Log", "/reports/change-log", "accounting"],
  ["month-end-close-log", "Month-End Close Log", "/reports/close-log", "accounting"],
  ["voided-entries", "Voided and Reversed Entries", "/reports/voided-entries", "accounting"],
] as const;

const appRoute = (href: string) => join(process.cwd(), "app", "(app)", ...href.split("/").filter(Boolean), "page.tsx");

describe("the Report Center after wave 1", () => {
  it("offers the ten new reports under the mockup's names, each on a page that exists", () => {
    for (const [id, title, href, group] of WAVE_1) {
      const report = REPORT_CATALOG.find((r) => r.id === id);
      expect(report, id).toMatchObject({ title, href, group });
      expect(existsSync(appRoute(href)), href).toBe(true);
    }
  });

  it("no longer carries Beancount, which lives in the sidebar now", () => {
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(40);
  });

  it("asks for audit.read before offering the Change Log, and for nothing else before the rest", () => {
    const changeLog = REPORT_CATALOG.find((r) => r.id === "change-log")!;
    expect(changeLog.anyPermissions).toEqual(CHANGE_LOG_PERMISSIONS);
    expect(canOpenReport(changeLog, ["audit.read"])).toBe(true);
    expect(canOpenReport(changeLog, ["journal.post"])).toBe(false);
    // A permission list that could not be read refuses, rather than opening onto a refusal.
    expect(canOpenReport(changeLog, null)).toBe(false);
    expect(REPORT_CATALOG.filter((r) => r.anyPermissions?.length).map((r) => r.id)).toEqual(["change-log"]);
    expect(canOpenReport(REPORT_CATALOG.find((r) => r.id === "open-invoices")!, null)).toBe(true);
  });

  it("checks the Change Log's permission on the page itself, from the same list", () => {
    const page = readFileSync(appRoute("/reports/change-log"), "utf8");
    expect(page).toMatch(/CHANGE_LOG_PERMISSIONS/);
    expect(page).toMatch(/permissionKeys: access\.permissionKeys \?\? \[\]/);
  });
});

describe("Beancount in the sidebar", () => {
  it("is the last item of Accounting, as in the client's mockup", () => {
    const accounting = NAV.find((item) => item.key === "accounting");
    const children = accounting && "children" in accounting ? accounting.children : [];
    expect(children.at(-1)).toEqual({ key: "/accounting/beancount", label: "Beancount" });
    expect(existsSync(appRoute("/accounting/beancount"))).toBe(true);
  });

  it("keeps its old address, which forwards with the query string", () => {
    const old = readFileSync(appRoute("/reports/beancount"), "utf8");
    expect(old).toMatch(/redirect\(rest \? `\/accounting\/beancount\?\$\{rest\}` : "\/accounting\/beancount"\)/);
  });

  it("does not load behind the Accounting overview's dashboard skeleton", () => {
    expect(existsSync(join(process.cwd(), "app", "(app)", "accounting", "beancount", "loading.tsx"))).toBe(true);
  });
});
