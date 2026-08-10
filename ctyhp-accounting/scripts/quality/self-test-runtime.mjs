import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { createReadOnlyContext } from "./browser.mjs";
import { auditPage } from "./page-audit.mjs";

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Runtime quality safety proof</title>
    <style>
      html, body { margin: 0; width: 100%; overflow-x: hidden; }
      main { padding: 24px; }
      input { width: 180px; height: 44px; }
      .accounting-data-table { width: 300px; overflow-x: auto; }
      .wide-row { width: 900px; height: 44px; }
    </style>
  </head>
  <body>
    <main id="main-content">
      <input type="text">
      <div class="accounting-data-table"><div class="wide-row"></div></div>
    </main>
  </body>
</html>`;

let postCount = 0;
const server = createServer((request, response) => {
  if (request.method === "POST") {
    postCount += 1;
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
    return;
  }
  response.writeHead(405, { allow: "GET" }).end();
});

let browser;
let passed = false;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "HTTP fixture must listen on an ephemeral port");

  browser = await chromium.launch({ headless: true });
  const guard = await createReadOnlyContext(browser, { viewport: { width: 800, height: 600 } });
  const page = await guard.context.newPage();
  const result = await auditPage(page, `http://127.0.0.1:${address.port}/`);

  assert(result.findings.some((finding) => finding.kind === "axe" && finding.rule === "label"),
    "Axe must report the synthetic unlabeled input");
  assert.equal(result.viewport.documentOverflow, 0,
    "an allowed table scroller must not become document overflow");
  assert.equal(result.viewport.internalScrollers, 1,
    "the fixture must exercise one allowed internal scroller");

  let fetchWasBlocked = false;
  try {
    await page.evaluate(() => fetch("/", { method: "POST" }));
  } catch {
    fetchWasBlocked = true;
  }
  assert.equal(fetchWasBlocked, true, "the in-page POST must be aborted by the route guard");
  assert.deepEqual(guard.blocked, [{ method: "POST", target: "/" }]);
  assert.throws(() => guard.assertSafe(), /Quality audit blocked a write request: POST \/$/);
  assert.equal(postCount, 0, "the blocked POST must never reach the server");
  passed = true;
} finally {
  if (browser) await browser.close();
  if (server.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (passed) process.stdout.write("runtime quality self-test passed\n");
