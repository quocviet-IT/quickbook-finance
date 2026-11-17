import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the Dashboard's third release (3.0.41) must keep, read from its
 * source: more periods, a year of cash flow, a forecast up to 90 days ahead,
 * and each card's choice kept for the person. Line endings are normalized:
 * this repository is checked out with CRLF on Windows, and a pattern spanning
 * lines must not depend on that.
 */
const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}

const profit = read("components/dashboard-home/ProfitWidgets.tsx");
const cash = read("components/dashboard-home/CashFlowWidget.tsx");
const chart = read("components/dashboard-home/charts/CashFlowChart.tsx");
const openItems = read("components/dashboard-home/OpenItemWidgets.tsx");
const client = read("app/(app)/dashboard/DashboardHomeClient.tsx");
const css = read("components/dashboard-home/dashboard-home.module.css");

describe("more periods on Profit and loss, Expenses and Sales", () => {
  it("says a period that could not be read by name, with Retry, and keeps the select in the head", () => {
    const missing = profit.match(/if \(!period\) \{[\s\S]*?<Widget title="([^"]+)" extra=\{extra\} footer=\{footer\}>\s*<Unavailable reason=\{periodUnread\(key\)\} \/>/g) ?? [];
    expect(missing).toHaveLength(3);
    for (const title of ["Profit and loss", "Expenses", "Sales"]) expect(missing.some((block) => block.includes(`title="${title}"`)), title).toBe(true);
    // Unavailable carries the Retry button that reads the page again.
    expect(read("components/dashboard-home/Widget.tsx")).toMatch(/export function Unavailable[\s\S]*?<RetryButton \/>/);
  });

  it("captions the bars as the last six months, whatever the period chosen", () => {
    expect(profit).toContain("<p className={styles.caption}>Income and expenses by month, last 6 months</p>");
    expect(profit).toContain("<p className={styles.caption}>Sales by month, last 6 months</p>");
  });

  it("makes the select wide enough for Last 12 months", () => {
    expect(css).toMatch(/\.period \{\s*width: 148px;\s*\}/);
  });

  it("takes each card's period from the screen, never a state of its own", () => {
    expect(profit).not.toMatch(/useState/);
    for (const card of ["ProfitAndLossWidget", "ExpensesWidget", "SalesWidget"]) {
      expect(profit).toContain(`export function ${card}({ profit, status, money, compact, period: key, onPeriodChange }: ProfitProps) {`);
    }
    expect(profit.match(/<PeriodSelect value=\{key\} onChange=\{onPeriodChange\}/g)).toHaveLength(3);
  });
});

describe("Cash flow: six or twelve months, and the forecast 30, 60 or 90 days ahead", () => {
  it("chooses its months in the card's head, draws that many from the end, and says so in its footer", () => {
    expect(cash).toContain('<ChoiceSelect value={span} onChange={onMonthsChange} options={CASH_MONTH_OPTIONS} label="Months of Cash flow" />');
    expect(cash).toContain("<span className={styles.caption}>{cashMonthsLabel(span)}</span>");
    expect(cash).toContain("const chartFrom = Math.max(0, data.months.length - span);");
    for (const series of ["months", "balanceMinor", "inMinor", "outMinor"]) expect(cash).toContain(`data.${series}.slice(chartFrom)`);
    expect(cash).not.toMatch(/useState/);
  });

  it("names every other month when twelve would touch, and keeps the projected day inside the chart", () => {
    expect(chart).toContain("const stride = labelStride(step, months.map((month) => month.label));");
    expect(chart).toMatch(/named\(i\) \? \(\s*<text key=\{`label-\$\{month\.key\}`\}/);
    expect(chart).toContain("placeEdgeLabel(projectionX, dayLabel, width - 2,");
    expect(chart).toMatch(/\{dayPlace \? \(\s*<text className=\{styles\.chartText\} x=\{dayPlace\.x\} y=\{BASE \+ 18\} textAnchor=\{dayPlace\.anchor\}>/);
    expect(chart).toContain("for the last ${count} months.");
  });

  it("makes the sentence, the strip and the dashed point follow the horizon chosen beside the sentence", () => {
    expect(cash).toContain("const projection = data.projections ? data.projections[horizon] : null;");
    expect(cash).toMatch(/<div className=\{styles\.forecastHead\}>\s*<p className=\{styles\.caption\}>\s*<b>\{horizonLabel\(horizon\)\}<\/b>, to \{formatDate\(projection\.through\)\}, if customers pay on their due dates\./);
    expect(cash).toMatch(/<ChoiceSelect\s+value=\{horizon\}\s+onChange=\{onHorizonChange\}\s+options=\{HORIZON_OPTIONS\}/);
    expect(cash).toContain("projection={projection ? { date: projection.through, valueMinor: projection.projectedMinor } : null}");
    // Every amount in the strip goes through Privacy's formatter.
    for (const amount of ["money(today)", "money(projection.invoicesDueMinor)", "money(projection.billsDueMinor)", "money(projection.projectedMinor)"]) {
      expect(cash).toContain(amount);
    }
    expect(cash).toContain("to see the next ${horizon} days.");
  });
});

describe("Invoices and Bills: due in 7 or 30 days", () => {
  it("chooses the window in each card's head, and the middle figure, the bar and the later figure follow it", () => {
    expect(openItems).toContain('<ChoiceSelect value={days} onChange={onDueChange} options={DUE_OPTIONS} label="Due window for Invoices" />');
    expect(openItems).toContain('<ChoiceSelect value={days} onChange={onDueChange} options={DUE_OPTIONS} label="Due window for Bills" />');
    expect(openItems).toContain("const due = dueWindowOf(side, days);");
    expect(openItems).toContain("stackShares([side.overdueMinor, due.dueMinor, due.laterMinor])");
    expect(openItems).toContain('{ key: "soon", label: dueLabel(days), color: DUE_SOON, minor: due.dueMinor, count: due.dueDocuments, share: soonShare }');
    expect(openItems).toContain("{ key: \"later\", label: laterLabel, color: laterColor, minor: due.laterMinor, count: due.laterDocuments, share: laterShare }");
    expect(openItems.match(/days=\{days\}/g)).toHaveLength(2);
    expect(openItems).not.toMatch(/useState/);
  });

  it("leaves the figures band and Needs attention at 7 days", () => {
    expect(read("components/dashboard-home/view.ts")).toContain("lead: `${money(figure.dueSoonMinor)} due in 7 days`");
    expect(read("lib/domain/dashboard-home/needs.ts")).toMatch(/next 7 days/);
  });
});

describe("each card's choice, kept for the person (3.0.41)", () => {
  it("starts from the person's choices, or the defaults when they could not be read", () => {
    expect(client).toContain("const [choices, setChoices] = useState<CardChoices>(() => preference?.cards ?? { ...DEFAULT_CARD_CHOICES });");
  });

  it("never saves defaults over choices it could not read: a change then stands for the visit only", () => {
    // The return comes after the screen changes and before anything is queued for saving.
    expect(client).toMatch(/setChoices\(next\);[\s\S]*?if \(preference === null\) return;\s*save\.unsaved = next;/);
  });

  it("hands every card its choice and a way to change it, Expenses one choice for both its tabs", () => {
    for (const [prop, key] of [
      ["months", "cashMonths"],
      ["horizon", "horizon"],
      ["period", "pnl"],
      ["period", "expenses"],
      ["period", "sales"],
      ["due", "invoicesDue"],
      ["due", "billsDue"],
    ]) {
      expect(client).toContain(`${prop}={choices.${key}}`);
      expect(client).toContain(`(next) => changeChoice("${key}", next)`);
    }
    // Expenses is drawn from the registry on Overview and on Money out: one card, one choice.
    expect(client.match(/choices\.expenses/g)).toHaveLength(1);
    expect(client).toMatch(/"money-out": \(\s*<>[\s\S]*?\{cards\.expenses\(4\)\}/);
  });

  it("shows a change at once and saves it afterwards, half a second after the last one, without reading the page again", () => {
    expect(client).toContain("const CHOICE_SAVE_DELAY_MS = 500;");
    const change = client.slice(client.indexOf("function changeChoice"), client.indexOf("// Leaving the dashboard"));
    expect(change.indexOf("setChoices(next);")).toBeGreaterThan(0);
    expect(change.indexOf("setChoices(next);")).toBeLessThan(change.indexOf("setTimeout("));
    expect(change).toContain("save.timer = setTimeout(() => void saveChoices(), CHOICE_SAVE_DELAY_MS);");
    expect(change).toContain("if (save.timer !== null) clearTimeout(save.timer);");
    const save = client.slice(client.indexOf("async function saveChoices"), client.indexOf("function changeChoice"));
    expect(save).toContain("ok = (await saveCardChoicesAction(next)).ok;");
    expect(save).not.toContain("router.refresh");
    expect(change).not.toContain("router.refresh");
  });

  it("says when a choice could not be saved, and keeps it on the screen", () => {
    const save = client.slice(client.indexOf("async function saveChoices"), client.indexOf("function changeChoice"));
    expect(save).toContain('if (!ok) message.error("Your choice could not be saved.");');
    expect(save).not.toContain("setChoices");
  });

  it("saves one at a time, so the last choices are the ones kept, and saves the last change when the page is left", () => {
    const save = client.slice(client.indexOf("async function saveChoices"), client.indexOf("function changeChoice"));
    expect(save).toContain("if (save.saving || !save.unsaved) return;");
    expect(save).toContain("if (save.unsaved && save.timer === null) void saveChoices();");
    expect(client).toMatch(/useEffect\(\(\) => \{\s*const save = choiceSave\.current;\s*return \(\) => \{[\s\S]*?void saveCardChoicesAction\(next\)\.catch\(\(\) => undefined\);/);
  });
});
