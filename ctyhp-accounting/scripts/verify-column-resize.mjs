/**
 * Prove RQ-01-REV on the real screen: dragging the edge of a column heading
 * narrows that column AND shortens the horizontal scroll.
 *
 * The second half is the whole point. The reviewer's complaint was "you have
 * to scroll again, wherever in left or right" — a resize that changes a
 * number without shortening the scrollbar would pass every unit test and fix
 * nothing.
 *
 * Writes nothing to the database. The only state it changes is this
 * browser profile's localStorage, which is thrown away with the browser.
 */
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.argv[3] ?? ".";

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

/** Column width, table width, and how far the reader must scroll to see it all. */
async function measure(page) {
  return page.evaluate(() => {
    // Scoped to the first table on the screen. The Statement imports register
    // sits below this one with a thead of its own, and measuring both would
    // report a column count that has nothing to do with this requirement.
    const table = document.querySelector(".ant-table");
    const ths = [...(table?.querySelectorAll(".ant-table-thead th") ?? [])];
    const byTitle = (title) => ths.find((th) => th.textContent?.trim().startsWith(title));
    const width = (th) => (th ? Math.round(th.getBoundingClientRect().width) : null);
    // The element that actually scrolls sideways.
    const scroller =
      table?.querySelector(".ant-table-body") ?? table?.querySelector(".ant-table-content");
    return {
      description: width(byTitle("Description")),
      amount: width(byTitle("Amount")),
      tableWidth: scroller ? Math.round(scroller.scrollWidth) : null,
      viewport: scroller ? Math.round(scroller.clientWidth) : null,
      hiddenOffScreen: scroller ? Math.round(scroller.scrollWidth - scroller.clientWidth) : null,
      headings: ths.map((th) => th.textContent?.trim()).filter(Boolean),
    };
  });
}

const session = await smokeSession();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies(
  sessionCookies(session.session, session.user, session.supabaseUrl, new URL(base).hostname),
);
const page = await context.newPage();

try {
  await page.goto(`${base}/banking`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ant-table-thead th", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const before = await measure(page);
  console.log("\nBefore:", JSON.stringify(before, null, 1));
  await page.screenshot({ path: `${shots}/resize-before.png`, fullPage: false });

  check("the table has a Description column", before.description !== null);
  check(
    "the reader has to scroll sideways to begin with",
    (before.hiddenOffScreen ?? 0) > 0,
    `${before.hiddenOffScreen}px off screen`,
  );

  // --- RES-01: is there a handle at all, and does it want a resize cursor? ---
  const handle = page.locator(".ant-table-thead th", { hasText: "Description" }).locator("span[aria-hidden]").last();
  check("Description's heading carries a resize handle", (await handle.count()) === 1);
  const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
  check("the handle asks for a horizontal resize cursor", cursor === "col-resize", cursor);
  const hit = await handle.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  check("the handle is 6-8px wide", hit >= 6 && hit <= 8, `${hit}px`);

  // --- RES-02/03/04: drag it 180px to the left ---
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = await measure(page);
  console.log("\nAfter dragging Description 180px left:", JSON.stringify(after, null, 1));
  await page.screenshot({ path: `${shots}/resize-after.png`, fullPage: false });

  check(
    "Description got narrower",
    after.description < before.description,
    `${before.description}px -> ${after.description}px`,
  );
  check(
    "THE SCROLLBAR GOT SHORTER — the actual complaint",
    after.hiddenOffScreen < before.hiddenOffScreen,
    `${before.hiddenOffScreen}px -> ${after.hiddenOffScreen}px off screen`,
  );
  check(
    "no column vanished",
    after.headings.length === before.headings.length,
    `${after.headings.length} headings`,
  );
  check(
    "the columns are still in their original order — the drag did not reorder",
    JSON.stringify(after.headings) === JSON.stringify(before.headings),
  );
  check(
    "Amount kept its own width",
    after.amount === before.amount,
    `${before.amount}px -> ${after.amount}px`,
  );
  check("horizontal scrolling is still available", (after.hiddenOffScreen ?? 0) >= 0);

  // --- RES-10: the drag must not have selected any row ---
  const checked = await page.locator(".ant-table-tbody .ant-checkbox-checked").count();
  check("resizing selected no rows", checked === 0, `${checked} rows checked`);

  // --- RES-12: does the width survive a reload? ---
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ant-table-thead th", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const reloaded = await measure(page);
  console.log("\nAfter reload:", JSON.stringify(reloaded, null, 1));
  check(
    "the narrowed width survived a reload",
    reloaded.description === after.description,
    `${after.description}px -> ${reloaded.description}px`,
  );

  // --- the bounds ---
  const box2 = await handle.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 - 900, box2.y + box2.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const floored = await measure(page);
  check(
    "dragging far past the left edge stops at the 60px floor",
    floored.description === 60,
    `${floored.description}px`,
  );
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
