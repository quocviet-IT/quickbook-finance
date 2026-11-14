import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_TABS } from "@/components/dashboard-home/view";
import type { DashboardHome } from "@/lib/services/dashboard-home";

/**
 * What the rebuilt Dashboard's screen must keep (3.0.38), read from its source.
 * Line endings are normalised: this repository is checked out with CRLF on
 * Windows, and a pattern spanning lines must not depend on that.
 */
const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(relative(ROOT, full)));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(relative(ROOT, full).replaceAll("\\", "/"));
  }
  return out;
}

const SCREEN = [...sourceFiles("app/(app)/dashboard"), ...sourceFiles("components/dashboard-home")];
const page = read("app/(app)/dashboard/page.tsx");
const client = read("app/(app)/dashboard/DashboardHomeClient.tsx");

describe("the Dashboard's tabs", () => {
  it("finds the screen's files to check", () => {
    // A broken walk would pass every check below by checking nothing.
    expect(SCREEN).toEqual(
      expect.arrayContaining([
        "app/(app)/dashboard/page.tsx",
        "app/(app)/dashboard/DashboardHomeClient.tsx",
        "components/dashboard-home/dashboard-home.module.css",
        "components/dashboard-home/charts/CashFlowChart.tsx",
      ]),
    );
  });

  it("are the four the address names, in order", () => {
    expect(HOME_TABS.map((tab) => tab.key)).toEqual(["overview", "money-in", "money-out", "banking"]);
  });

  it("are Ant Design tabs, read from ?tab= and written back without reading the page again", () => {
    expect(client).toMatch(/import \{[^}]*\bTabs\b[^}]*\} from "antd"/);
    expect(client).toContain('homeTabOf(useSearchParams().get("tab"))');
    expect(client).toContain('window.history.replaceState(null, "", homeTabHref(next))');
    expect(client).not.toMatch(/router\.(push|replace)\(/);
  });

  it("give every tab its cards", () => {
    for (const { key } of HOME_TABS) expect(client).toMatch(new RegExp(`^\\s+"?${key}"?: \\(`, "m"));
  });

  it("leave out what this release does not have: Privacy, Customize, layouts", () => {
    for (const word of ["Privacy", "Customize", "preset", "draggable"]) {
      for (const file of SCREEN) expect(read(file), `${file} mentions ${word}`).not.toContain(word);
    }
  });
});

describe("what is streamed in after the figures", () => {
  it("wraps Needs attention and Month-end close in their own Suspense boundaries", () => {
    expect(page).toMatch(/<Suspense fallback=\{<NeedsAttention loading \/>\}>\s*<NeedsSection report=\{needs\} \/>/);
    expect(page).toMatch(/<Suspense fallback=\{<MonthEndClose loading \/>\}>\s*<CloseSection asOf=\{today\} \/>/);
  });

  it("reads Needs attention once, without waiting for it, and takes the tab counts from the same read", () => {
    expect(page.match(/getHomeNeeds\(/g)).toHaveLength(1);
    expect(page).not.toMatch(/await[^;]*getHomeNeeds\(/);
    expect(page).toMatch(/needs\.then\(\s*\(report\) => needsByTab\(report\.needs\),\s*\(\) => null,?\s*\)/);
    expect(read("app/(app)/dashboard/NeedsSection.tsx")).toMatch(/await report/);
  });

  it("shows a tab's count only once it has come, inside its own Suspense", () => {
    expect(client).toMatch(/<Suspense fallback=\{null\}>\s*<TabCount counts=\{counts\} tab=\{key\} \/>\s*<\/Suspense>/);
    expect(client).toMatch(/const count = use\(counts\)\?\.\[tab\] \?\? 0;\s*if \(count <= 0\) return null;/);
  });

  it("keeps the page a server component that reads afresh on every visit", () => {
    expect(page).toContain('export const dynamic = "force-dynamic";');
    expect(page).not.toContain('"use client"');
    expect(client.startsWith('"use client"')).toBe(true);
  });
});

describe("each card stands on its own", () => {
  // The envelope sections of the page, each named by the card that draws it.
  const sections: Record<Exclude<keyof DashboardHome, "asOf" | "generatedAt">, string> = {
    status: "components/dashboard-home/BooksNote.tsx",
    figures: "components/dashboard-home/FigureBand.tsx",
    cash: "components/dashboard-home/CashFlowWidget.tsx",
    profit: "components/dashboard-home/ProfitWidgets.tsx",
    receivables: "components/dashboard-home/OpenItemWidgets.tsx",
    payables: "components/dashboard-home/OpenItemWidgets.tsx",
    payments: "components/dashboard-home/OpenItemWidgets.tsx",
    bank: "components/dashboard-home/BooksWidgets.tsx",
    activity: "components/dashboard-home/BooksWidgets.tsx",
    insights: "components/dashboard-home/BooksWidgets.tsx",
  };

  it("hands every section to its card as an envelope", () => {
    for (const section of Object.keys(sections)) expect(client).toContain(`home.${section}`);
  });

  it("draws the unavailable state from the envelope when a section's read failed", () => {
    const unavailable = /if \(!data\) \{\s*return \(\s*<(Widget|div)[\s\S]{0,240}?<Unavailable reason=/g;
    const count = (file: string) => read(file).match(unavailable)?.length ?? 0;
    expect(count("components/dashboard-home/CashFlowWidget.tsx")).toBe(1);
    expect(count("components/dashboard-home/FigureBand.tsx")).toBe(1);
    // Profit and loss, Expenses, Sales.
    expect(count("components/dashboard-home/ProfitWidgets.tsx")).toBe(3);
    // Invoices, Bills, Recent payments; the aging card handles either side alone.
    expect(count("components/dashboard-home/OpenItemWidgets.tsx")).toBe(3);
    expect(read("components/dashboard-home/OpenItemWidgets.tsx")).toMatch(/if \(!ar && !ap\) \{\s*return \(\s*<Widget[\s\S]{0,160}?<Unavailable/);
    // Bank accounts, Insights, Recent accounting activity.
    expect(count("components/dashboard-home/BooksWidgets.tsx")).toBe(3);
    expect(read("components/dashboard-home/BooksNote.tsx")).toMatch(/if \(!status\.data\) \{[\s\S]{0,400}?<RetryButton \/>/);
  });

  it("says the rest of the page is still current, and reads the page again on Retry", () => {
    const widget = read("components/dashboard-home/Widget.tsx");
    expect(widget).toContain("The other figures on this page are still current.");
    expect(widget).toContain("start(() => router.refresh())");
  });

  it("guards the streamed reads, so a failure there is that card's alone", () => {
    expect(read("app/(app)/dashboard/NeedsSection.tsx")).toMatch(/try \{\s*read = await report;\s*\} catch/);
    expect(read("app/(app)/dashboard/NeedsSection.tsx")).toContain("<NeedsAttention failure={CHECKS_FAILED} />");
    expect(read("app/(app)/dashboard/CloseSection.tsx")).toMatch(/try \{[\s\S]*getHomeClose\(sb, \{ asOf \}\)[\s\S]*\} catch/);
    expect(read("app/(app)/dashboard/CloseSection.tsx")).toContain('<MonthEndClose failure="Month-end close could not be read." />');
  });
});

describe("money on the Dashboard", () => {
  it("writes a payment in its own currency, never as base currency", () => {
    const widgets = read("components/dashboard-home/OpenItemWidgets.tsx");
    expect(widgets).toContain("formatMoney(payment.amountMinor, payment.currencyCode, payment.decimals)");
    for (const file of SCREEN) {
      const source = read(file);
      // Every payment amount on the screen goes through its own currency.
      const uses = source.match(/payment\.amountMinor/g)?.length ?? 0;
      const own = source.match(/formatMoney\(payment\.amountMinor, payment\.currencyCode, payment\.decimals\)/g)?.length ?? 0;
      expect(uses, file).toBe(own);
      expect(source, file).not.toMatch(/money\(\s*payment\./);
    }
  });

  it("totals payments from the base-currency sum only, and counts the others apart", () => {
    const widgets = read("components/dashboard-home/OpenItemWidgets.tsx");
    expect(widgets).toContain("money(received.baseMinor)");
    expect(widgets).toContain("otherCurrencies(received.otherCurrencyCount)");
    expect(widgets).toContain("money(paid.baseMinor)");
    expect(widgets).toContain("otherCurrencies(paid.otherCurrencyCount)");
  });

  it("formats with the company's base currency, handed down from the page", () => {
    expect(page).toMatch(/const baseCurrency = \{ code: base\?\.code \?\? "USD", decimals: base\?\.decimal_places \?\? 2 \};/);
    expect(client).toContain("formatMoney(minor, currency.code, currency.decimals)");
    expect(client).toContain("formatCompactMoney(minor, currency.code, currency.decimals)");
  });

  it("adds only cash to Cash on hand, and lists the cards after it as what is owed", () => {
    const bank = read("components/dashboard-home/BooksWidgets.tsx");
    const other = bank.indexOf("Cash not in a bank account");
    const total = bank.indexOf('<th scope="row">Cash on hand</th>');
    const cards = bank.indexOf("Credit cards");
    expect(other).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(other);
    expect(cards).toBeGreaterThan(total);
    expect(bank).toContain("money(cashMinor)");
    expect(bank).toContain("cardBalance(minor, money)");
  });

  it("says that transfers between the company's own accounts count on both sides while they do", () => {
    expect(read("components/dashboard-home/CashFlowWidget.tsx")).toMatch(
      /data\.transfersExcluded \? null : <p className=\{styles\.caption\}>Transfers between your own accounts count on both sides\.<\/p>/,
    );
  });
});

describe("colour on the Dashboard", () => {
  it("has no hex colour and never reads the light-only TOKENS", () => {
    for (const file of SCREEN) {
      const source = read(file);
      expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], file).toEqual([]);
      expect(source, file).not.toMatch(/\bTOKENS\./);
    }
  });

  it("colours SVG shapes through their style, never a presentation attribute holding a colour", () => {
    for (const file of SCREEN.filter((path) => path.endsWith(".tsx"))) {
      const source = read(file);
      const attributes = source.match(/\b(fill|stroke)="[^"]*"/g) ?? [];
      expect(attributes.filter((attribute) => !/="(none|transparent)"$/.test(attribute)), file).toEqual([]);
      expect(source, file).not.toMatch(/\b(fill|stroke)=\{/);
    }
  });

  it("draws expenses and money out in the second chart colour, and the donut in the five agreed", () => {
    expect(read("components/dashboard-home/charts/CashFlowChart.tsx")).toContain('tokenVar("series.secondary")');
    expect(read("components/dashboard-home/ProfitWidgets.tsx")).toMatch(
      /DONUT_COLORS = \[\s*tokenVar\("series\.income"\),\s*tokenVar\("series\.secondary"\),\s*tokenVar\("series\.net"\),\s*tokenVar\("series\.governance"\),\s*tokenVar\("series\.other"\),\s*\]/,
    );
  });
});

describe("the old Dashboard is gone", () => {
  it("leaves no old page component behind", () => {
    expect(existsSync(join(ROOT, "app/(app)/dashboard/DashboardClient.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "components/dashboard/WorkQueueCard.tsx"))).toBe(false);
  });

  it("keeps what the rest of the app reads from the old service, and nothing it no longer needs", () => {
    const service = read("lib/services/dashboard.ts");
    for (const name of ["getDashboardAnalytics", "getDashboardMetrics", "getOperatingPulse", "getInventoryDashboard"]) {
      expect(service).not.toContain(name);
    }
    for (const kept of [
      "export { todayInTimeZone }",
      "export function trailingMonthRanges(",
      "export function describeAuditActivity(",
      "export function comparablePreviousMonthRange(",
      "export function percentChange(",
      "export interface AgingSnapshot",
      "export interface CashMovementSnapshot",
      "export interface MonthlyPerformancePoint",
      "export interface DashboardActivity",
    ]) {
      expect(service).toContain(kept);
    }
  });
});
