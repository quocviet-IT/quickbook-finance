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
  const context = await browser.newContext({ viewport });
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
