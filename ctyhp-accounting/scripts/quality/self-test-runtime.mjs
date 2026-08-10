import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { closeRuntimeResources, createReadOnlyContext } from "./browser.mjs";
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
      button { width: 20px; height: 20px; }
      .accounting-data-table { width: 300px; overflow-x: auto; }
      .wide-row { width: 900px; height: 44px; }
    </style>
  </head>
  <body>
    <main id="main-content">
      <input id="Acme-Customer-123" class="Acme-Customer-field" type="text">
      <button id="Acme-Customer-button" class="Acme-Customer-action" aria-label="Small action"></button>
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
    if (request.url === "/sw.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(`
        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener("message", (event) => {
          event.waitUntil(fetch("/", { method: "POST" }).then(() => event.source?.postMessage("bypass-complete")));
        });
      `);
      return;
    }
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
  const serviceWorkerAttempt = await page.evaluate(async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 2_000)),
      ]);
      const bypassEstablished = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 1_000);
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data !== "bypass-complete") return;
          clearTimeout(timeout);
          resolve(true);
        }, { once: true });
        registration.active.postMessage("attempt-bypass");
      });
      return { registered: true, bypassEstablished };
    } catch {
      return { registered: false, bypassEstablished: false };
    }
  });
  assert.deepEqual(serviceWorkerAttempt, { registered: false, bypassEstablished: false },
    "service workers must be blocked before they can attempt to bypass request routing");
  const serializedResult = JSON.stringify(result);
  assert(!serializedResult.includes("Acme-Customer"),
    "findings must not retain customer-shaped DOM ids or classes");

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
  await closeRuntimeResources(browser, server);
}

if (passed) {
  assert.equal(browser.isConnected(), false, "browser must be disconnected before success is reported");
  assert.equal(server.listening, false, "HTTP fixture must be closed before success is reported");
  process.stdout.write("runtime quality self-test passed\n");
}
