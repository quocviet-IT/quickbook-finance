import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { privacyFormatters } from "@/components/dashboard-home/privacy";
import { PRIVATE_AMOUNT, PRIVATE_COMPACT } from "@/lib/domain/dashboard-home/privacy";

/**
 * What the Dashboard's second release (3.0.39) must keep, read from its
 * source: Privacy, Customize and the account watchlist. Line endings are
 * normalized: this repository is checked out with CRLF on Windows, and a
 * pattern spanning lines must not depend on that.
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
const actions = read("app/(app)/dashboard/actions.ts");
const panel = read("components/dashboard-home/CustomizePanel.tsx");
const watchlist = read("components/dashboard-home/WatchlistWidget.tsx");

describe("the page header", () => {
  it("finds the new files to check", () => {
    expect(SCREEN).toEqual(
      expect.arrayContaining([
        "app/(app)/dashboard/actions.ts",
        "components/dashboard-home/CustomizePanel.tsx",
        "components/dashboard-home/WatchlistWidget.tsx",
        "components/dashboard-home/privacy.tsx",
      ]),
    );
  });

  it("has Refresh, then the Privacy switch with a real label, then Customize", () => {
    const refresh = client.indexOf(">\n              Refresh\n            </Button>");
    const privacy = client.search(/<label className=\{styles\.privacy\}>\s*<Switch size="small" checked=\{privacy\}[\s\S]*?\/>\s*Privacy\s*<\/label>/);
    const customize = client.search(/<Button\s+icon=\{<AppstoreOutlined aria-hidden="true" \/>\}\s+aria-pressed=\{editing\}[\s\S]*?>\s*Customize\s*<\/Button>/);
    expect(refresh).toBeGreaterThan(0);
    expect(privacy).toBeGreaterThan(refresh);
    expect(customize).toBeGreaterThan(privacy);
    expect(client).toMatch(/import \{[^}]*\bSwitch\b[^}]*\} from "antd"/);
  });
});

describe("Privacy", () => {
  it("changes at once, is saved for the person, and switches back with a message when it is not", () => {
    expect(client).toMatch(
      /async function changePrivacy\(on: boolean\) \{\s*onPrivacyChange\(on\);[\s\S]*?await setPrivacyAction\(on\);[\s\S]*?if \(!result\.ok\) \{\s*onPrivacyChange\(!on\);\s*message\.error\("Privacy could not be saved\."\);/,
    );
    expect(client).toContain("useState(props.preference?.privacy ?? false)");
  });

  it("is provided around the whole screen, the streamed cards included", () => {
    expect(client).toMatch(/<PrivacyProvider on=\{privacy\} currency=\{props\.currency\}>\s*<DashboardScreen /);
    expect(client).toContain("const { money, compact } = usePrivacy();");
  });

  it("is read by Needs attention and Month-end close themselves, not handed to them", () => {
    const needs = read("components/dashboard-home/NeedsAttention.tsx");
    const close = read("components/dashboard-home/MonthEndClose.tsx");
    expect(needs).toContain("const { text } = usePrivacy();");
    expect(needs).toContain("{text(need.detail)}");
    expect(close).toContain("const { text } = usePrivacy();");
    expect(close).toContain("{text(step.title)}");
    for (const source of [needs, close]) expect(source).not.toMatch(/\bmoney[?]?:/);
  });

  it("masks the sentences written on the server: insights and the bank statuses", () => {
    const books = read("components/dashboard-home/BooksWidgets.tsx");
    expect(books).toContain("{text(insight.headline)}");
    expect(books).toContain("{text(insight.detail)}");
    expect(books).toContain("label: text(account.statusText)");
  });

  it("writes every amount on the screen through its formatters, and none of its own", () => {
    for (const file of SCREEN.filter((path) => path !== "components/dashboard-home/privacy.tsx")) {
      const source = read(file);
      expect(source, file).not.toMatch(/\b(formatMoney|formatCompactMoney|formatSignedMoney|formatBaseMoney)\(/);
      expect(source, file).not.toMatch(/Intl\.NumberFormat/);
      expect(source, file).not.toMatch(/const (money|compact) = \(/);
      expect(source, file).not.toMatch(/style: "currency"/);
    }
  });

  it("keeps a change's arrow and words and masks its amount", () => {
    expect(read("components/dashboard-home/Widget.tsx")).toContain("{on ? PRIVATE_CHANGE : money(Math.abs(minor))}");
  });

  it("formats in the base currency while off, and masks everything while on", () => {
    const off = privacyFormatters(false, { code: "USD", decimals: 2 });
    expect([off.money(123_456), off.compact(2_000_000), off.own(900_00, "EUR", 2), off.text("Owe $1,234.56")]).toEqual([
      "$1,234.56",
      "$20K",
      "€900.00",
      "Owe $1,234.56",
    ]);
    const on = privacyFormatters(true, { code: "USD", decimals: 2 });
    expect([on.money(123_456), on.compact(2_000_000), on.own(900_00, "EUR", 2), on.text("Owe $1,234.56 · 3 days late")]).toEqual([
      PRIVATE_AMOUNT,
      PRIVATE_COMPACT,
      PRIVATE_AMOUNT,
      `Owe ${PRIVATE_AMOUNT} · 3 days late`,
    ]);
  });
});

describe("Customize", () => {
  it("opens on the Overview through the address, with a copy to cancel back to; pressed again, it cancels", () => {
    expect(client).toMatch(
      /function toggleCustomize\(\) \{\s*if \(editing\) \{\s*setDraft\(null\);\s*return;\s*\}\s*setDraft\(layout\);\s*if \(tab !== "overview"\) changeTab\("overview"\);/,
    );
    expect(client).toContain('onCancel={() => setDraft(null)}');
  });

  it("draws its panel on the Overview tab only, between the tabs and the cards", () => {
    expect(client.match(/<CustomizePanel /g)).toHaveLength(1);
    expect(client).toMatch(
      /\{key === "overview" && draft \? \(\s*<CustomizePanel [\s\S]*?\/>\s*\) : null\}\s*<div className=\{styles\.grid\}>\{panels\[key\]\}<\/div>/,
    );
  });

  it("says what the approved panel says, as a named region", () => {
    expect(panel).toContain('role="region" aria-label="Customize the Overview tab"');
    expect(panel).toContain(">Customize the Overview tab</h2>");
    expect(panel).toContain("<b>Start from</b>");
    expect(panel).toMatch(/HOME_PRESETS\.map\(\(preset\) => \(\s*<Button key=\{preset\.key\} size="small" onClick=\{\(\) => onChange\(presetLayout\(preset\.key\)\)\}>/);
    expect(panel).toContain("Drag a card to move it, or use the arrows. The button above a card makes it wider or narrower.");
    expect(panel).toContain("aria-label={`Move ${title} earlier`}");
    expect(panel).toContain("aria-label={`Move ${title} later`}");
    expect(panel).toContain("disabled={index === 0}");
    expect(panel).toContain("disabled={index === last}");
    expect(panel).toMatch(/<Button type="primary" loading=\{saving\} onClick=\{onSave\}>\s*Save layout\s*<\/Button>/);
    expect(panel).toMatch(/>\s*Cancel\s*<\/Button>/);
    expect(panel).toContain("The layout is yours alone; other people in the company keep their own.");
  });

  it("outlines each card, lets it be dragged before another, and offers Wider or Narrower above it", () => {
    expect(client).toContain("draggable={edit ? true : undefined}");
    expect(client).toContain('aria-label={`Make ${edit.title} ${edit.wide ? "narrower" : "wider"}`}');
    expect(client).toContain('{edit.wide ? "Narrower" : "Wider"}');
    expect(client).toContain("moveWidgetBefore(current, moving, key)");
    expect(client).toContain("<HolderOutlined className={styles.grip} aria-hidden=\"true\" />");
  });

  it("draws no hidden card, and says so when every card is hidden", () => {
    expect(client).toContain("const visible = overview.order.filter((key) => overview.shown.includes(key));");
    expect(client).toContain('<Empty title="Every card is hidden">Tick at least one card above.</Empty>');
  });

  it("saves without reading the page again, and stays open with the reason when it cannot", () => {
    const save = client.slice(client.indexOf("function saveLayout()"), client.indexOf("function endDrag()"));
    expect(save).toContain("await saveOverviewLayoutAction(next)");
    // setLayoutKnown (3.0.40): what was just saved is the person's own, and is remembered for the loading outline.
    expect(save).toMatch(
      /if \(result\.ok\) \{\s*setLayout\(next\);\s*setLayoutKnown\(true\);\s*setDraft\(null\);\s*message\.success\("Layout saved"\);\s*\} else \{\s*message\.error\(result\.error\);/,
    );
    expect(save).not.toContain("router.refresh");
  });

  it("draws the Overview from a registry of every card, the streamed two among them", () => {
    expect(client).toContain("const cards: Record<HomeWidgetKey, (span: 4 | 6 | 8 | 12) => ReactNode> = {");
    expect(client).toContain("needs: () => needs,");
    expect(client).toContain("close: () => close,");
  });
});

describe("the account watchlist", () => {
  it("sits on Banking and close at full width, between Month-end close and Recent accounting activity", () => {
    expect(client).toMatch(
      /banking: \(\s*<>\s*<Cell span=\{8\} mid=\{12\}>\s*\{cards\.bank\(8\)\}\s*<\/Cell>\s*<Cell span=\{4\} mid=\{12\}>\s*\{cards\.close\(4\)\}\s*<\/Cell>\s*<Cell span=\{12\} mid=\{12\}>\s*\{cards\.watchlist\(12\)\}\s*<\/Cell>\s*<Cell span=\{12\} mid=\{12\}>\s*\{cards\.activity\(12\)\}/,
    );
    expect(client).toContain("watchlist: (span) => <WatchlistWidget watchlist={home.watchlist} width={span} currencyCode={currency.code} />,");
  });

  it("shows five columns wide and three narrow, with the caption under them", () => {
    expect(watchlist).toContain("const wide = width >= 8;");
    expect(watchlist).toContain("{wide ? <th scope=\"col\">Type</th> : null}");
    expect(watchlist).toMatch(/\{wide \? \(\s*<th scope="col" className=\{styles\.num\}>\s*Last month \(\{currencyCode\}\)/);
    expect(watchlist).toContain("This month and last month are each account&apos;s activity.");
    expect(watchlist).toMatch(/Balance is what the Chart of Accounts shows: this fiscal year for\s+income and expense accounts, every other account since the books began\./);
  });

  it("chooses accounts in a modal with plain state, no Form, and reads the page again after saving", () => {
    expect(watchlist).not.toMatch(/import \{[^}]*\bForm\b[^}]*\} from "antd"/);
    expect(watchlist).not.toContain("<Form");
    expect(watchlist).toContain('title="Choose accounts to watch"');
    expect(watchlist).toMatch(/<Select\s+mode="multiple"\s+maxCount=\{WATCHLIST_MAX\}/);
    expect(watchlist).toContain('showSearch={{ optionFilterProp: "label" }}');
    expect(watchlist).toContain("Up to 10 accounts. They are yours alone.");
    // The page is read again inside the save's transition, and the picker closes only when that is done,
    // so the card never says "No accounts" for the seconds the read takes.
    expect(watchlist).toMatch(/await saveWatchlistAction\(selected\);[\s\S]*?startSaving\(\(\) => router\.refresh\(\)\);/);
    expect(watchlist).toMatch(/if \(!saving && saved\.current\) \{\s*saved\.current = false;\s*onClose\(\);/);
    expect(watchlist).toContain('<Empty title="No accounts on your watchlist yet." action={choose} />');
    expect(watchlist).toContain('<TextLink href="/accounts">Chart of accounts</TextLink>');
  });
});

describe("the server decides whose choices and which company", () => {
  it("reads the preference beside the company settings, with the person's own client for the register", () => {
    expect(page).toMatch(/await Promise\.all\(\[getCurrentCompanySettings\(sb\), listCurrencies\(sb\), readPreference\(\)\]\)/);
    expect(page).toMatch(/const \{ active \} = await resolveActiveCompany\(\);[\s\S]*?createSupabaseServerClientForSchema\("onebook"\);[\s\S]*?readDashboardPreference\(control, active\.id\)/);
    expect(page).toContain("watchlist: preference ? preference.watchlist : null,");
    expect(page).toContain("preference={preference}");
  });

  it("has actions that take no person and no company from the browser", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).toContain('createSupabaseServerClientForSchema("onebook")');
    expect(actions).toContain("await sb.auth.getUser()");
    expect(actions).toContain("const { active } = await resolveActiveCompany();");
    expect(actions).toContain("return await run(sb, active.id);");
    const exported = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    expect(exported).toEqual([
      ["saveOverviewLayoutAction", "layout: unknown"],
      ["saveWatchlistAction", "accountIds: unknown"],
      ["setPrivacyAction", "on: unknown"],
      // Each card's choice (3.0.41).
      ["saveCardChoicesAction", "choices: unknown"],
    ]);
    // An account must be in the open company's own chart.
    expect(actions).toMatch(/createSupabaseServerClient\(\);\s*const \{ data, error \} = await books\.from\("acc_account"\)\.select\("id"\)\.in\("id", ids\)/);
  });
});

describe("color in the new parts", () => {
  it("has no hex color and never reads the light-only TOKENS", () => {
    for (const file of ["components/dashboard-home/CustomizePanel.tsx", "components/dashboard-home/WatchlistWidget.tsx", "components/dashboard-home/privacy.tsx", "app/(app)/dashboard/actions.ts"]) {
      const source = read(file);
      expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], file).toEqual([]);
      expect(source, file).not.toMatch(/\bTOKENS\./);
    }
    const css = read("components/dashboard-home/dashboard-home.module.css");
    for (const rule of [".customize {", ".editing {", ".dropTarget {", ".editBar {", ".allHidden {", ".privacy {"]) {
      const body = css.slice(css.indexOf(rule), css.indexOf("}", css.indexOf(rule)));
      expect(body, rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    }
  });
});
