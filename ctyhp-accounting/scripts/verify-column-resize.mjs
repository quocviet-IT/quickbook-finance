/**
 * Prove column resizing on the real screens: dragging the edge of a column
 * heading narrows that column AND shortens the horizontal scroll.
 *
 * The second half is the whole point. The reviewer's complaint, on both
 * videos, was about scrolling — "you have to scroll again, wherever in left
 * or right" — so a resize that changes a number without shortening the
 * scrollbar would pass every unit test and fix nothing.
 *
 * Covers both screens the requirement landed on:
 *
 *   * Bank Transactions (RQ-01-REV, first follow-up video)
 *   * the General Ledger report (REQ-01, second video — the report whose
 *     DATE / DESCRIPTION / DEBIT / CREDIT / BALANCE columns are the ones
 *     actually on screen in it; Bank Transactions has no debit, credit or
 *     balance column at all)
 *
 * Writes nothing to the database. The only state it changes is this browser
 * profile's localStorage, which is thrown away with the browser.
 *
 * Run: npm run build && npm start, then
 *      node --env-file=.env.local scripts/verify-column-resize.mjs
 */
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.argv[3] ?? ".";

/** The same cookie shape `@supabase/ssr` reads, as the smoke sweep builds it. */
function sessionCookies(session, user, supabaseUrl, domain) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user,
  };
  const encoded = "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const name = `sb-${ref}-auth-token`;
  const CHUNK = 3180;
  const cookies = [];
  if (encoded.length <= CHUNK) cookies.push({ name, value: encoded });
  else {
    for (let i = 0; i * CHUNK < encoded.length; i++) {
      cookies.push({ name: `${name}.${i}`, value: encoded.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  }
  return cookies.map((c) => ({ ...c, domain, path: "/", httpOnly: false, secure: false }));
}

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Column widths, table width, and how far the reader must scroll to see it all.
 *
 * Scoped to the first table on the screen: Bank Transactions has the Statement
 * imports register below it with a thead of its own, and measuring both would
 * report a column count that has nothing to do with this requirement.
 */
async function measure(page, wideTitle, otherTitle) {
  return page.evaluate(
    ([wide, other]) => {
      const table = document.querySelector(".ant-table");
      const ths = [...(table?.querySelectorAll(".ant-table-thead th") ?? [])];
      const byTitle = (title) => ths.find((th) => th.textContent?.trim().startsWith(title));
      const width = (th) => (th ? Math.round(th.getBoundingClientRect().width) : null);
      const scroller =
        table?.querySelector(".ant-table-body") ?? table?.querySelector(".ant-table-content");
      return {
        wide: width(byTitle(wide)),
        other: width(byTitle(other)),
        hiddenOffScreen: scroller ? Math.round(scroller.scrollWidth - scroller.clientWidth) : null,
        headings: ths.map((th) => th.textContent?.trim()).filter(Boolean),
      };
    },
    [wideTitle, otherTitle],
  );
}

/** Drag a heading's right edge by `dx` pixels. Negative is narrower. */
async function dragHandle(page, handle, dx) {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/**
 * Every assertion the change requests ask for, against one screen.
 *
 * `wide` is the long-text column the reviewer was dragging; `other` is any
 * neighbour, which must not move while `wide` does.
 */
async function verifyScreen(page, { name, wide, other, shotPrefix }) {
  console.log(`\n=== ${name} ===`);
  const before = await measure(page, wide, other);
  console.log("Before:", JSON.stringify(before));
  await page.screenshot({ path: `${shots}/${shotPrefix}-before.png` });

  check(`${name}: the table has a ${wide} column`, before.wide !== null);

  // TC-01 / RES-01: is there a handle, and does it announce itself?
  const handle = page
    .locator(".ant-table-thead th", { hasText: wide })
    .locator("span[aria-hidden]")
    .last();
  check(`${name}: ${wide}'s heading carries a resize handle`, (await handle.count()) === 1);
  const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
  check(`${name}: the handle asks for a horizontal resize cursor`, cursor === "col-resize", cursor);
  const hit = await handle.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  check(`${name}: the handle is 6-8px wide`, hit >= 6 && hit <= 8, `${hit}px`);

  // TC-03 / RES-02: narrower.
  await dragHandle(page, handle, -180);
  const narrower = await measure(page, wide, other);
  console.log(`After dragging ${wide} 180px left:`, JSON.stringify(narrower));
  await page.screenshot({ path: `${shots}/${shotPrefix}-after.png` });

  check(
    `${name}: ${wide} got narrower`,
    narrower.wide < before.wide,
    `${before.wide}px -> ${narrower.wide}px`,
  );
  check(
    `${name}: THE SCROLL GOT SHORTER — the actual complaint`,
    narrower.hiddenOffScreen < before.hiddenOffScreen,
    `${before.hiddenOffScreen}px -> ${narrower.hiddenOffScreen}px off screen`,
  );
  check(
    `${name}: ${other} kept its own width`,
    narrower.other === before.other,
    `${before.other}px -> ${narrower.other}px`,
  );
  check(
    `${name}: no column vanished`,
    narrower.headings.length === before.headings.length,
    `${narrower.headings.length} headings`,
  );
  check(
    `${name}: the columns did not reorder`,
    JSON.stringify(narrower.headings) === JSON.stringify(before.headings),
  );
  // TC-08 / RES-10.
  const checked = await page.locator(".ant-table-tbody .ant-checkbox-checked").count();
  check(`${name}: resizing selected no rows`, checked === 0, `${checked} rows checked`);

  // TC-02: wider again. The video's own gesture was to widen DESCRIPTION so
  // more of it could be read.
  await dragHandle(page, handle, 260);
  const wider = await measure(page, wide, other);
  check(
    `${name}: ${wide} can be widened again`,
    wider.wide > narrower.wide,
    `${narrower.wide}px -> ${wider.wide}px`,
  );
  check(
    `${name}: horizontal scrolling still works once the table exceeds the page`,
    (wider.hiddenOffScreen ?? 0) > 0,
    `${wider.hiddenOffScreen}px off screen`,
  );

  // The floor: drag far past the left edge.
  await dragHandle(page, handle, -1200);
  const floored = await measure(page, wide, other);
  check(`${name}: narrowing stops at the 60px floor`, floored.wide === 60, `${floored.wide}px`);

  return floored.wide;
}

/**
 * The General Ledger shows nothing until an account and a date range have been
 * run, so the table this requirement is about does not exist on first load.
 * Picks the first account that actually has posted activity.
 */
async function openGeneralLedgerReport(page) {
  await page.goto(`${base}/reports/general-ledger`, { waitUntil: "networkidle" });

  // Scoped to this report's own filter bar. The app shell carries a company
  // switcher that is also an `.ant-select`, and it is the FIRST one in the
  // document — reaching for it by position would change company rather than
  // pick an account.
  const filters = page.locator('[aria-label="General Ledger filters"]');
  await filters.waitFor({ timeout: 30_000 });

  await filters.locator(".ant-picker-range input").first().fill("2000-01-01");
  await page.keyboard.press("Enter");
  await filters.locator(".ant-picker-range input").last().fill("2035-12-31");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const accountSelect = filters.locator(".ant-select").first();
  await accountSelect.click();
  await page.waitForSelector(".ant-select-item-option", { timeout: 15_000 });
  const total = await page.locator(".ant-select-item-option").count();

  for (let i = 0; i < Math.min(total, 12); i++) {
    if (i > 0) {
      await accountSelect.click();
      await page.waitForSelector(".ant-select-item-option", { timeout: 15_000 });
    }
    await page.locator(".ant-select-item-option").nth(i).click();
    await page.getByRole("button", { name: "Run report" }).click();
    await page.waitForTimeout(2500);
    if ((await page.locator(".ant-table-tbody tr.ant-table-row").count()) > 0) return true;
  }
  await page.screenshot({ path: `${shots}/resize-gl-nodata.png` });
  return false;
}

const session = await smokeSession();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies(
  sessionCookies(session.session, session.user, session.supabaseUrl, new URL(base).hostname),
);
const page = await context.newPage();

try {
  // --- Bank Transactions (RQ-01-REV) ---
  await page.goto(`${base}/banking`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ant-table-thead th", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await verifyScreen(page, {
    name: "Bank Transactions",
    wide: "Description",
    other: "Amount",
    shotPrefix: "resize-banking",
  });

  // TC-09 / RES-12: does the width survive a reload?
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ant-table-thead th", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const reloaded = await measure(page, "Description", "Amount");
  check(
    "Bank Transactions: the narrowed width survived a reload",
    reloaded.wide === 60,
    `${reloaded.wide}px`,
  );

  // --- General Ledger (REQ-01, the second video's screen) ---
  const opened = await openGeneralLedgerReport(page);
  check("General Ledger: a report with activity could be opened", opened);
  if (opened) {
    await verifyScreen(page, {
      name: "General Ledger",
      wide: "Memo",
      other: "Debit",
      shotPrefix: "resize-gl",
    });
  }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
