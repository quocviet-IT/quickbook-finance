/**
 * Words the reader cannot read whole: broken mid-word, cut off by the box they
 * sit in, a column heading stacked on three lines, a placeholder longer than
 * its field.
 *
 * The UI review of 2026-10-19 found "Requeste/d" broken across two lines on
 * Approvals, "Dismissec" cut on Banking Overview, a Dashboard tab reading
 * "Apprc", a search box reading "refe…", and headings such as "Expense Number"
 * and "Past payments caught" stacked over two and three lines. None of it
 * throws, logs or fails a test; only a laid-out page shows it. This walks every
 * signed-in route at the two widths the design commits to and measures the
 * text itself.
 *
 *   BROKEN       a word split across two lines
 *   CLIPPED      text running past the edge of a box that hides its overflow
 *                (an ellipsis counts: the reader still cannot see the rest)
 *   HEADING      a table column heading laid out on more than one line
 *   PLACEHOLDER  placeholder text wider than the field that shows it
 *   OVERLAP      two of the header's controls drawn on top of each other
 *
 * Text cut on purpose with an ellipsis is fine when the whole of it is one hover
 * away: a title, or an Ant Design tooltip (found by pointing at the box and
 * looking). Text cut at the edge of a row that scrolls sideways is never fine;
 * nobody scrolls a row of tabs to read the last one.
 *
 * Reads only: one sign-in, then a GET per route, on the sample company.
 *
 *   node --env-file=.env.local scripts/verify-text-fit.mjs [baseUrl] [--only=journal,approvals] [--json]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { smokeSession } from "./smoke-environment.mjs";
import { playwrightSessionCookies } from "./quality/session-cookie.mjs";
import { discoverStaticRoutes } from "./quality/routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const asJson = args.includes("--json");
const only = (args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => (r.startsWith("/") ? r : `/${r}`));

/** 1470 is the reporter's own screen; 1280 is the floor the spec sets. */
const VIEWPORTS = [
  { width: 1470, height: 801 },
  { width: 1280, height: 800 },
];

const routes = only.length ? only : discoverStaticRoutes(join(here, "..", "app", "(app)"));

/** Measured in the page, because only the browser knows what it laid out. */
const MEASURE = () => {
  const findings = [];
  // Overlays are measured when they open, not here; text for screen readers only is clipped on purpose.
  const SKIP = "script, style, noscript, svg, .ant-tooltip, .ant-popover, .ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown, .ant-message, .ant-notification, [aria-hidden='true'], .sr-only, .accounting-sr-only";
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
  };
  // A name a reader would recognise: the nearest label-ish text around it.
  const describe = (el) => {
    const cls = (el.className && typeof el.className === "string" ? el.className : "")
      .split(/\s+/)
      .filter((c) => c && !c.startsWith("css-"))
      .slice(0, 2)
      .join(".");
    const th = el.closest("th");
    const td = el.closest("td");
    let column = "";
    if (td) {
      const table = td.closest("table");
      const index = Array.from(td.parentElement.children).indexOf(td);
      const head = table?.querySelector("thead tr")?.children[index] ?? table?.closest(".ant-table")?.querySelector("thead tr")?.children[index];
      column = head ? ` in column "${(head.textContent || "").trim().slice(0, 30)}"` : "";
    }
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${th ? " (heading)" : column}`;
  };
  const range = document.createRange();
  const tops = (rects) => new Set(rects.filter((r) => r.width > 0.5).map((r) => Math.round(r.top / 4)));

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenClip = new Set();
  let probeCount = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!/[A-Za-z]{2,}/.test(text)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP) || !visible(parent)) continue;

    // BROKEN: one word whose glyphs sit on two lines.
    const word = /[A-Za-z][A-Za-z'’]{3,}/g;
    let m;
    while ((m = word.exec(text))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      if (tops(Array.from(range.getClientRects())).size > 1) {
        findings.push({ kind: "BROKEN", text: m[0], where: describe(parent), context: text.trim().slice(0, 60) });
      }
    }

    // CLIPPED: the laid-out text runs past a box that hides what overflows.
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
    if (!rects.length) continue;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    for (let box = parent; box && box !== document.body; box = box.parentElement) {
      const cs = getComputedStyle(box);
      if (cs.overflowX === "visible" && cs.textOverflow !== "ellipsis") continue;
      // A table scrolls on purpose and has its own gate (verify-table-fit). Anything
      // else that scrolls sideways still shows a word cut at its edge: the
      // Dashboard's queue filters read "Apprc" until scrolled.
      const scrolls = cs.overflowX === "auto" || cs.overflowX === "scroll";
      // A file shown as text (the Beancount ledger) scrolls sideways by design.
      if (scrolls && (box.closest(".ant-table") || box.tagName === "PRE")) break;
      const b = box.getBoundingClientRect();
      const inner = { left: b.left + box.clientLeft, right: b.left + box.clientLeft + box.clientWidth };
      const over = Math.round(Math.max(right - inner.right, inner.left - left));
      if (over > 2) {
        const key = `${describe(box)}|${text.trim().slice(0, 40)}`;
        if (!seenClip.has(key)) {
          seenClip.add(key);
          const titled = !!(parent.closest("[title]") || box.closest("[title]"));
          // A box cut without a title may still open a tooltip on hover (Ant
          // Design's Tooltip leaves no mark in the page until then): tag it, so
          // the runner can point at it and look.
          let probe = null;
          if (!titled && !scrolls) {
            probe = String(probeCount++);
            box.setAttribute("data-textfit-probe", probe);
          }
          findings.push({
            kind: "CLIPPED",
            text: text.trim().slice(0, 60),
            where: describe(box),
            titled,
            scrolls,
            probe,
            detail: `${over}px hidden${scrolls ? ", scrolls" : ""}${cs.textOverflow === "ellipsis" ? ", ellipsis" : ""}${titled ? ", has title" : ""}`,
          });
        }
        break;
      }
    }
  }

  // HEADING: a column heading whose words wrap onto a second line. A heading
  // built as two lines on purpose (Balance over its date) is two pieces of text,
  // each on one line, and is not counted.
  for (const th of document.querySelectorAll("thead th")) {
    if (!visible(th) || th.closest(SKIP)) continue;
    let lines = 1;
    const tw = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!(n.textContent ?? "").trim()) continue;
      range.selectNodeContents(n);
      lines = Math.max(lines, tops(Array.from(range.getClientRects())).size);
    }
    if (lines > 1) {
      findings.push({
        kind: "HEADING",
        text: (th.textContent || "").trim().slice(0, 40),
        where: describe(th),
        detail: `${lines} lines at ${Math.round(th.getBoundingClientRect().width)}px`,
      });
    }
  }

  // PLACEHOLDER: wider than the field. Chrome cuts a placeholder with an
  // ellipsis before the measured text reaches the edge: "Search number,
  // vendor, or memo" measured 207px and was cut in a 209px field. So a
  // placeholder needs some room to spare, not merely to fit.
  const SPARE = 8;
  const canvas = document.createElement("canvas").getContext("2d");
  for (const input of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    if (!visible(input) || input.value || input.closest(SKIP)) continue;
    const cs = getComputedStyle(input);
    canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need = canvas.measureText(input.placeholder).width;
    const have = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (need + SPARE > have) {
      findings.push({
        kind: "PLACEHOLDER",
        text: input.placeholder.slice(0, 60),
        where: describe(input),
        detail: `needs ${Math.round(need)}px, has ${Math.round(have)}px`,
      });
    }
  }
  // An Ant Design Select shows its placeholder in a span, cut with an ellipsis: CLIPPED catches it.

  // OVERLAP: two of the header's controls drawn on top of each other. The
  // company list ran out of a box squeezed narrower than itself and sat on the
  // search field at 1024, 1280 and 1440 (2.30) — every word in both still fit
  // its own box, so nothing above could see it.
  const controls = Array.from(
    document.querySelectorAll(".app-shell__header :is(.ant-select, .ant-btn, .app-shell__approvals, .app-shell__company)"),
  ).filter((el) => visible(el) && !el.closest(SKIP));
  const outermost = controls.filter((el) => !controls.some((other) => other !== el && other.contains(el)));
  for (let i = 0; i < outermost.length; i++) {
    for (let j = i + 1; j < outermost.length; j++) {
      const a = outermost[i].getBoundingClientRect();
      const b = outermost[j].getBoundingClientRect();
      const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (across > 1 && down > 1) {
        findings.push({
          kind: "OVERLAP",
          text: `${(outermost[i].textContent || outermost[i].getAttribute("aria-label") || "").trim().slice(0, 24)} / ${(outermost[j].textContent || outermost[j].getAttribute("aria-label") || "").trim().slice(0, 24)}`,
          where: `${describe(outermost[i])} and ${describe(outermost[j])}`,
          detail: `${Math.round(across)}px across`,
        });
      }
    }
  }
  return findings;
};

const auth = await smokeSession();
const control = createClient(auth.supabaseUrl, auth.anonKey, {
  auth: { persistSession: false },
  db: { schema: "onebook" },
  global: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
});
const { data: companies } = await control.rpc("my_companies");
const sample = companies.find((c) => c.slug === (process.env.SHOT_COMPANY ?? "pc"));
if (!sample?.is_sample) throw new Error("The sample company is not available to this user");

const browser = await chromium.launch();
const all = [];
/** Cut on purpose, and readable whole from a title or a tooltip: counted, not failed. */
let readable = 0;
/** Routes that could not be measured even on a second try: a gate that skips is not a pass. */
const skipped = [];
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport, timezoneId: "America/Los_Angeles" });
  await context.addCookies([
    ...playwrightSessionCookies({ ...auth, appBaseUrl: base }),
    { name: "onebook-company", value: sample.slug, url: base },
  ]);
  let page = await context.newPage();
  if (!asJson) console.log(`\n== ${viewport.width}x${viewport.height} ==`);
  for (const route of routes) {
    // A route that sends the reader on (from-files to Reconcile) can still be
    // navigating when the next one is asked for, and one late redirect then
    // interrupts every route after it. On an interruption, start a fresh tab and
    // try the route once more.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await measureRoute(page, route, viewport);
        break;
      } catch (err) {
        await page.close().catch(() => {});
        page = await context.newPage();
        if (attempt === 2) {
          skipped.push(`${viewport.width} ${route}`);
          if (!asJson) console.log(`  SKIP        ${route} — ${err.message.split("\n")[0]}`);
        }
      }
    }
  }
  await context.close();
}
await browser.close();

async function measureRoute(page, route, viewport) {
  await page.goto(base + route, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(600);
  // Settled where a redirect took it, if it took it anywhere.
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  const findings = await page.evaluate(MEASURE);
  // Point at one box of each kind that is cut without a title, and see
  // whether a tooltip opens with its words. The same component answers the
  // same way on every row, so one look stands for all of them.
  const tooltipBy = new Map();
  for (const f of findings) {
    if (!f.probe || tooltipBy.has(f.where)) continue;
    let shown = false;
    try {
      await page.locator(`[data-textfit-probe="${f.probe}"]`).hover({ timeout: 2_000 });
      await page.waitForTimeout(450);
      const tips = await page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").allInnerTexts();
      const needle = f.text.slice(0, 16);
      shown = tips.some((tip) => tip.includes(needle));
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
    } catch {
      shown = false;
    }
    tooltipBy.set(f.where, shown);
  }
  for (const f of findings) {
    if (f.kind === "CLIPPED" && !f.scrolls && (f.titled || tooltipBy.get(f.where))) {
      readable++;
      continue;
    }
    all.push({ width: viewport.width, route, kind: f.kind, text: f.text, where: f.where, detail: f.detail, context: f.context });
    if (!asJson) console.log(`  ${f.kind.padEnd(11)} ${route}  "${f.text}"  ${f.where}${f.detail ? `  (${f.detail})` : ""}${f.context && f.context !== f.text ? `  in "${f.context}"` : ""}`);
  }
}

if (asJson) console.log(JSON.stringify({ findings: all, skipped }));
else {
  const count = (kind) => all.filter((f) => f.kind === kind).length;
  console.log(`\n${count("BROKEN")} broken words, ${count("CLIPPED")} clipped with no way to read them whole, ${count("HEADING")} stacked headings, ${count("PLACEHOLDER")} cut placeholders, ${count("OVERLAP")} overlapping header controls`);
  console.log(`${readable} cut on purpose with a title or tooltip (fine)`);
  console.log(`${skipped.length} route(s) not measured${skipped.length ? `: ${skipped.join(", ")}` : ""}`);
}
process.exit(all.length > 0 || skipped.length > 0 ? 1 : 0);
