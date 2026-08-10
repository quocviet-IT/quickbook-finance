import AxeBuilder from "@axe-core/playwright";
import { installMetricObservers } from "./browser.mjs";

function viewportFinding(rule, target, value) {
  return {
    kind: "viewport",
    rule,
    target,
    ...(Number.isFinite(value) ? { value } : {}),
  };
}

export function classifyViewportSnapshot(snapshot) {
  const findings = [];
  if (Number(snapshot.documentOverflow) > 0) {
    findings.push(viewportFinding("document-overflow", "document", Number(snapshot.documentOverflow)));
  }
  for (const target of snapshot.clippedTargets ?? []) {
    findings.push(viewportFinding("viewport-clipping", target));
  }
  for (const target of snapshot.shellOverlaps ?? []) {
    findings.push(viewportFinding("fixed-shell-overlap", target));
  }
  for (const item of snapshot.smallTargets ?? []) {
    const target = typeof item === "string" ? item : item.target;
    findings.push(viewportFinding("target-size", target, typeof item === "string" ? undefined : item.minimum));
  }
  return { ...snapshot, findings };
}

export async function inspectViewport(page) {
  const snapshot = await page.evaluate(() => {
    const designatedScrollerSelector = ".accounting-data-table, .ant-modal-body, .ant-drawer-body";
    const interactiveSelector = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [tabindex]:not([tabindex='-1'])";
    const primarySelector = "[data-primary-action], .ant-btn-primary, button[type=submit], input[type=submit], [aria-current=page]";
    const inspectedSelector = `#main-content, #main-content ${interactiveSelector.split(", ").join(", #main-content ")}`;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    const visible = (element, style = getComputedStyle(element)) => {
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const safeTarget = (element) => {
      const id = element.id;
      if (id && /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/.test(id)) return `#${CSS.escape(id)}`;
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      return role && /^[a-z-]{1,32}$/.test(role) ? `${tag}[role=${role}]` : tag;
    };
    const intersects = (first, second) => first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top;

    const rootWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const documentOverflow = Math.max(0, Math.ceil(rootWidth - viewportWidth));

    const internalScrollers = [...document.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      const ownsOverflow = element.matches(designatedScrollerSelector)
        || style.overflowX === "auto"
        || style.overflowX === "scroll";
      return ownsOverflow && element.scrollWidth > element.clientWidth;
    }).length;

    const clippedTargets = [...document.querySelectorAll(primarySelector)].filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight;
    }).map(safeTarget);

    const shells = [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      if (!visible(element, style)) return false;
      if (style.position !== "fixed" && style.position !== "sticky") return false;
      return element.matches("header, [role=banner], aside, nav, [role=navigation], .ant-layout-header, .ant-layout-sider, .ant-drawer-content-wrapper, .ant-modal-wrap")
        || style.position === "fixed";
    });
    const shellOverlaps = [...document.querySelectorAll(inspectedSelector)].filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return shells.some((shell) => shell !== element && !shell.contains(element) && intersects(rect, shell.getBoundingClientRect()));
    }).map(safeTarget);

    const smallTargets = [...document.querySelectorAll(interactiveSelector)].filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        target: safeTarget(element),
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        minimum: Math.round(Math.min(rect.width, rect.height) * 100) / 100,
      };
    });

    return { documentOverflow, internalScrollers, clippedTargets, shellOverlaps, smallTargets };
  });

  return classifyViewportSnapshot(snapshot);
}

function safeAxeTarget(target) {
  const raw = Array.isArray(target) ? target.join(" > ") : String(target ?? "[target]");
  return /^[#.a-zA-Z0-9_:\- >+~,[\]()]+$/.test(raw) && raw.length <= 240 ? raw : "[target]";
}

function axeFindings(results) {
  return results.violations.flatMap((violation) => violation.nodes.map((node) => ({
    kind: "axe",
    rule: violation.id,
    impact: violation.impact ?? "unknown",
    target: safeAxeTarget(node.target),
  })));
}

export async function auditPage(page, options) {
  const {
    url,
    screenshotPath,
    mainSelector = "#main-content",
    navigationTimeout = 30_000,
  } = typeof options === "string" ? { url: options } : options;

  await installMetricObservers(page);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
  await page.waitForSelector(mainSelector, { state: "visible", timeout: navigationTimeout });
  await page.waitForTimeout(500);

  const [axeResults, viewport, timing] = await Promise.all([
    new AxeBuilder({ page }).analyze(),
    inspectViewport(page),
    page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const quality = window.__oneBookQuality ?? {
        lcp: 0,
        cls: 0,
        interactions: [],
        longTasks: [],
        unsupported: ["lcp", "cls", "interactions", "longTasks"],
      };
      return {
        navigation: navigation ? {
          responseStart: Number(navigation.responseStart),
          responseEnd: Number(navigation.responseEnd),
          domContentLoaded: Number(navigation.domContentLoadedEventEnd),
          loadEventEnd: Number(navigation.loadEventEnd),
          duration: Number(navigation.duration),
        } : null,
        metrics: {
          lcp: Number(quality.lcp),
          cls: Number(quality.cls),
          interactions: quality.interactions.map(Number),
          longTasks: quality.longTasks.map(Number),
          unsupported: [...quality.unsupported],
        },
      };
    }),
  ]);

  const findings = [...axeFindings(axeResults), ...viewport.findings];
  if (findings.length && screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  return {
    status: response?.status() ?? null,
    findings,
    viewport,
    navigation: timing.navigation,
    metrics: timing.metrics,
  };
}
