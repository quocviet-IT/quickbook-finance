const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeRequestMethod(method) {
  const normalized = String(method ?? "").toUpperCase();
  return /^[A-Z]{1,24}$/.test(normalized) ? normalized : "[invalid-method]";
}

export function isAllowedBrowserMethod(method) {
  return ALLOWED_METHODS.has(safeRequestMethod(method));
}

export function safeRequestTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.pathname
      : "[non-http-url]";
  } catch {
    return "[invalid-url]";
  }
}

export async function createReadOnlyContext(browser, { cookies = [], viewport } = {}) {
  const blocked = [];
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });

  try {
    if (cookies.length) await context.addCookies(cookies);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const method = safeRequestMethod(request.method());
      if (isAllowedBrowserMethod(method)) {
        await route.continue();
        return;
      }

      blocked.push({ method, target: safeRequestTarget(request.url()) });
      await route.abort("blockedbyclient");
    });
  } catch (setupError) {
    try {
      await context.close();
    } catch (closeError) {
      throw new AggregateError([setupError, closeError], "Read-only browser context setup and cleanup failed");
    }
    throw setupError;
  }

  return {
    context,
    blocked,
    assertSafe() {
      if (blocked.length) {
        const { method, target } = blocked[0];
        throw new Error(`Quality audit blocked a write request: ${method} ${target}`);
      }
    },
  };
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => error ? reject(error) : resolve());
    } catch (error) {
      reject(error);
    }
  });
}

export async function closeRuntimeResources(browser, server) {
  const operations = [];
  if (browser) operations.push(browser.close());
  operations.push(closeServer(server));
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Runtime browser and server cleanup failed");
}

export async function installMetricObservers(page) {
  await page.addInitScript(() => {
    const quality = {
      lcp: 0,
      cls: 0,
      interactions: [],
      longTasks: [],
      unsupported: [],
    };
    window.__oneBookQuality = quality;

    const observe = (metric, type, callback) => {
      try {
        if (typeof PerformanceObserver !== "function") throw new Error("unsupported");
        const observer = new PerformanceObserver(callback);
        observer.observe({ type, buffered: true });
      } catch {
        quality.unsupported.push(metric);
      }
    };

    observe("lcp", "largest-contentful-paint", (list) => {
      const entries = list.getEntries();
      quality.lcp = Number(entries.at(-1)?.startTime ?? 0);
    });
    observe("cls", "layout-shift", (list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) quality.cls += Number(entry.value ?? 0);
      }
    });
    observe("interactions", "event", (list) => {
      for (const entry of list.getEntries()) quality.interactions.push(Number(entry.duration ?? 0));
    });
    observe("longTasks", "longtask", (list) => {
      for (const entry of list.getEntries()) quality.longTasks.push(Number(entry.duration ?? 0));
    });
  });
}
