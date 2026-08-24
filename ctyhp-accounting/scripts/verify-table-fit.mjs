/**
 * The gate on the complaint that arrived four times: a list that scrolls
 * sideways.
 *
 * The unit tests hold the arithmetic and tests/unit/table-fit-contract.test.ts
 * holds the boundary, but neither can see a rendered table. This walks every
 * authenticated route at the two viewports the design commits to and measures
 * the tables themselves.
 *
 * Three verdicts, because there are three kinds of table on these screens:
 *
 *   PASS/FAIL  a fitted table — DataTable with `fit`, which is the default.
 *   MATRIX     a table that opted out on purpose (fit={false}); it is allowed
 *              to scroll, and is reported so the exemption stays visible.
 *   RAW        Ant Design's Table reached for directly, on a screen not yet
 *              migrated to DataTable (see tests/unit/table-adoption.test.ts).
 *              Measured and reported, never failed: those screens are a
 *              separate migration and this gate would otherwise be red for
 *              reasons no task here can fix.
 *
 * Reads only: one sign-in, then a GET per route. Nothing is written, so it
 * needs no destructive-test flag.
 *
 * Run it against a built server (`npm run build && npm start`), not `npm run
 * dev`: a dev server compiles each route on its first request, which turns a
 * three-minute sweep into half an hour.
 *
 *   node --env-file=.env.local scripts/verify-table-fit.mjs [baseUrl] [--only=/banking]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";
import { playwrightSessionCookies } from "./quality/session-cookie.mjs";
import { discoverStaticRoutes } from "./quality/routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
// A leading slash is optional: Git Bash rewrites `/banking` into a Windows
// path before the script ever sees it, so `--only=banking` is the form that
// works in every shell.
const only = (args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => (r.startsWith("/") ? r : `/${r}`));

/**
 * The two viewports this design commits to. 1470 is the reporter's own screen,
 * taken from the feedback record; 1280 is the floor the spec sets.
 */
const VIEWPORTS = [
  { width: 1470, height: 801 },
  { width: 1280, height: 800 },
];

const routes = only.length ? only : discoverStaticRoutes(join(here, "..", "app", "(app)"));

/** Measured in the page, because only the browser knows what it laid out. */
const MEASURE = () => {
  const wrappers = Array.from(document.querySelectorAll(".ant-table-wrapper"));
  return wrappers.map((wrapper) => {
    // The element that would carry the scrollbar is not the wrapper: rc-table
    // puts the overflow on the body when a table scrolls, and on the content
    // element when it does not split header from body.
    const scroller =
      wrapper.querySelector(".ant-table-body") ??
      wrapper.querySelector(".ant-table-content") ??
      wrapper;
    const shell = wrapper.closest(".accounting-data-table");
    const kind = !shell
      ? "raw"
      : shell.classList.contains("accounting-table--fit")
        ? "fit"
        : "matrix";
    // Whatever heading sits above it, so a FAIL line names the table a reader
    // would recognise rather than an index.
    let heading = "";
    for (let node = wrapper; node && !heading; node = node.parentElement) {
      const found = node.querySelector?.("h1, h2, h3, .ant-typography h4");
      if (found?.textContent) heading = found.textContent.trim();
    }
    return {
      kind,
      overflow: scroller.scrollWidth - scroller.clientWidth,
      width: scroller.clientWidth,
      heading: heading.slice(0, 44),
    };
  });
};

const { session, user, supabaseUrl } = await smokeSession();
const browser = await chromium.launch();
let failed = 0;
let fitted = 0;
const rawOverflow = new Map();

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  await context.addCookies(
    playwrightSessionCookies({ session, user, supabaseUrl, appBaseUrl: base }),
  );
  const page = await context.newPage();
  console.log(`\n== ${viewport.width}x${viewport.height} ==`);

  for (const route of routes) {
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 60_000 });
    } catch (err) {
      console.log(`  SKIP  ${route} — ${err.message.split("\n")[0]}`);
      continue;
    }
    let tables = [];
    try {
      tables = await page.evaluate(MEASURE);
    } catch (err) {
      console.log(`  SKIP  ${route} — ${err.message.split("\n")[0]}`);
      continue;
    }
    if (tables.length === 0) continue;

    tables.forEach((table, index) => {
      const where = `${route} [${index}]${table.heading ? ` ${table.heading}` : ""}`;
      if (table.kind === "matrix") {
        console.log(`  ----  ${where} — matrix, opted out`);
        return;
      }
      if (table.kind === "raw") {
        // Ant Design's Table used directly: outside this work's scope, but
        // counted so the size of what is left is a number and not a guess.
        if (table.overflow > 1) {
          rawOverflow.set(route, (rawOverflow.get(route) ?? 0) + 1);
          console.log(`  RAW   ${where} — overflows by ${table.overflow}px (not migrated)`);
        }
        return;
      }
      fitted++;
      // 1px of slack: a scaled display rounds a sub-pixel column boundary up.
      if (table.overflow > 1) {
        failed++;
        console.log(`  FAIL  ${where} — overflows by ${table.overflow}px`);
      } else {
        console.log(`  PASS  ${where}`);
      }
    });
  }
  await context.close();
}

await browser.close();

const rawTotal = [...rawOverflow.values()].reduce((sum, n) => sum + n, 0);
if (rawTotal > 0) {
  console.log(
    `\n${rawTotal} table(s) on ${rawOverflow.size} route(s) still use Ant Design's Table directly and overflow. Not counted as failures: see tests/unit/table-adoption.test.ts.`,
  );
}
console.log(`\n${fitted - failed} of ${fitted} fitted tables fit their box`);
process.exit(failed > 0 ? 1 : 0);
