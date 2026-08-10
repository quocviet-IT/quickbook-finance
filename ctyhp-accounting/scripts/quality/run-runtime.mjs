import { lstatSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { smokeSession } from "../smoke-environment.mjs";
import {
  BUDGETS,
  VIEWPORTS,
  qualityMode,
  qualityPaths,
  runtimeSchedule,
} from "./config.mjs";
import {
  closeRuntimeResources,
  createReadOnlyContext,
  installMetricObservers,
  safeRequestTarget,
} from "./browser.mjs";
import { median, qualityExitCode, redactQualityValue } from "./model.mjs";
import { auditPage } from "./page-audit.mjs";
import { aggregateQualityArtifacts, writeQualityReport } from "./report.mjs";
import { discoverStaticRoutes } from "./routes.mjs";
import { playwrightSessionCookies } from "./session-cookie.mjs";
import {
  KEYBOARD_SCENARIOS,
  KeyboardSafetyError,
  runKeyboardScenarios,
} from "./keyboard.mjs";

const PERFORMANCE_FIELDS = Object.freeze([
  "navigationMs",
  "responseMs",
  "ttfbMs",
  "dclMs",
  "loadMs",
  "lcpMs",
  "cls",
  "interactionMs",
  "longTaskMs",
  "transferredBytes",
  "failedSubresources",
]);
const VIEWPORT_BY_NAME = new Map(VIEWPORTS.map((viewport) => [viewport.name, viewport]));

function normalizeRoute(route) {
  const trimmed = String(route ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function selectRuntimeRoutes(discoveredRoutes, only = "") {
  const discovered = [...new Set(discoveredRoutes.map(normalizeRoute).filter(Boolean))].sort();
  if (!String(only).trim()) return discovered;
  const requested = new Set(String(only).split(",").map(normalizeRoute).filter(Boolean));
  const unknown = [...requested].filter((route) => !discovered.includes(route));
  if (unknown.length) {
    throw new Error("QUALITY_ONLY must contain only a discovered static authenticated route");
  }
  return discovered.filter((route) => requested.has(route));
}

export function performanceMedians(samples) {
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new Error("Performance reporting requires exactly three measured navigations");
  }
  return Object.fromEntries(PERFORMANCE_FIELDS.map((field) => {
    const values = samples.map((sample) => sample[field]);
    return [field, values.every(Number.isFinite) ? median(values) : null];
  }));
}

export async function waitForLoadFinalization(page, timeout = 5_000) {
  try {
    await page.waitForLoadState("load", { timeout });
    return true;
  } catch {
    return false;
  }
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

export function performanceSample(snapshot, { loadFinalized, failedSubresources }) {
  const navigation = snapshot?.navigation;
  if (!navigation) return null;
  const metrics = snapshot.metrics ?? {};
  const unsupported = new Set(metrics.unsupported ?? []);
  const interactions = Array.isArray(metrics.interactions) ? metrics.interactions.map(Number).filter(Number.isFinite) : [];
  const longTasks = Array.isArray(metrics.longTasks) ? metrics.longTasks.map(Number).filter(Number.isFinite) : [];
  const resources = Array.isArray(snapshot.resources) ? snapshot.resources : [];
  const transferSupported = loadFinalized
    && Number.isFinite(navigation.transferSize)
    && resources.every((entry) => Number.isFinite(entry.transferSize));
  const loadMs = loadFinalized && Number(navigation.loadEventEnd) > 0
    ? finiteOrNull(navigation.loadEventEnd)
    : null;

  return {
    navigationMs: loadMs === null ? null : finiteOrNull(navigation.duration),
    responseMs: finiteOrNull(navigation.responseEnd),
    ttfbMs: finiteOrNull(navigation.responseStart),
    dclMs: finiteOrNull(navigation.domContentLoadedEventEnd),
    loadMs,
    lcpMs: unsupported.has("lcp") ? null : finiteOrNull(metrics.lcp),
    cls: unsupported.has("cls") ? null : finiteOrNull(metrics.cls),
    interactionMs: unsupported.has("interactions") || interactions.length === 0
      ? null
      : Math.max(...interactions),
    longTaskMs: unsupported.has("longTasks") ? null : longTasks.reduce((sum, value) => sum + value, 0),
    transferredBytes: transferSupported
      ? Number(navigation.transferSize) + resources.reduce((sum, entry) => sum + Number(entry.transferSize), 0)
      : null,
    failedSubresources: finiteOrNull(failedSubresources),
  };
}

export function isLoginLocation(value) {
  try {
    const pathname = new URL(String(value), "http://quality.invalid").pathname;
    const canonical = pathname.replace(/\/+$/, "") || "/";
    return canonical === "/login";
  } catch {
    return false;
  }
}

export function navigationSafetyFailures({ route, status, finalPath, errorBoundary, pageError }) {
  const failures = [];
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    failures.push({ kind: "document-navigation", route, status: Number.isInteger(status) ? status : 0 });
  }
  if (isLoginLocation(finalPath)) failures.push({ kind: "auth", route });
  if (errorBoundary) failures.push({ kind: "error-boundary", route });
  if (pageError) failures.push({ kind: "page-error", route });
  return failures;
}

export function isUnsafeOwnedRootEntry(entry) {
  return !entry?.isDirectory?.() || Boolean(entry?.isSymbolicLink?.());
}

function contained(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..\\`)
    && !fromRoot.startsWith("../")
    && !isAbsolute(fromRoot);
}

function validateOwnedDirectory(path) {
  let entry;
  try {
    entry = lstatSync(path);
  } catch {
    throw new Error("Owned quality result root must be a real directory");
  }
  if (isUnsafeOwnedRootEntry(entry)) {
    throw new Error("Owned quality result root must be a real directory, not a link or reparse target");
  }
  return realpathSync(path);
}

export function validateOwnedResultRoots(resultsDir, screenshotRoot) {
  const lexicalResults = resolve(resultsDir);
  const lexicalScreenshots = resolve(screenshotRoot);
  const physicalResults = validateOwnedDirectory(lexicalResults);
  const physicalScreenshots = validateOwnedDirectory(lexicalScreenshots);
  const physicalParent = realpathSync(dirname(lexicalResults));
  if (!contained(physicalParent, physicalResults) || !contained(lexicalResults, lexicalScreenshots)
    || !contained(physicalResults, physicalScreenshots)) {
    throw new Error("Owned quality result root and screenshot root must remain physically contained");
  }
  return { resultsDir: physicalResults, screenshotRoot: physicalScreenshots };
}

export function subresourceFinding({ route, viewport, url, resourceType, status }) {
  return {
    kind: "subresource",
    rule: "request-failed",
    route,
    viewport,
    target: safeRequestTarget(url),
    resourceType: /^[a-z]{1,24}$/.test(String(resourceType)) ? String(resourceType) : "other",
    ...(Number.isInteger(status) ? { status } : {}),
  };
}

function section(extra = {}) {
  return { findings: [], measurements: [], unavailable: [], safetyFailures: [], ...extra };
}

export function keyboardSection(results) {
  const viewports = new Map(KEYBOARD_SCENARIOS.map((scenario) => [
    scenario.id,
    scenario.viewport.width <= 375 ? "mobile" : "desktop",
  ]));
  const scenarios = Array.isArray(results) ? results : [];
  return section({
    scenarios,
    findings: scenarios.filter(({ status }) => status === "failed").map((result) => ({
      kind: "keyboard",
      rule: result.id,
      route: result.route,
      viewport: viewports.get(result.id) ?? "desktop",
      target: result.focusedAfter,
      message: result.message,
    })),
  });
}

export function runtimeAuditPhases(only = "") {
  return {
    keyboard: true,
    routes: String(only).trim() !== "keyboard",
  };
}

function resolvedBaseUrl(raw) {
  const parsed = new URL(raw || "http://localhost:3000");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("QUALITY_BASE_URL must use HTTP or HTTPS");
  }
  return parsed.origin;
}

function writeSection(resultsDir, name, value) {
  const path = join(resultsDir, name);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(redactQualityValue(value), null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function writeRuntimeArtifacts(resultsDir, sections) {
  writeSection(resultsDir, "axe.json", sections.axe);
  writeSection(resultsDir, "keyboard.json", sections.keyboard);
  writeSection(resultsDir, "viewports.json", sections.viewports);
  writeSection(resultsDir, "web-vitals.json", sections.performance);
  writeSection(resultsDir, "routes.json", sections.routes);
}

function routeSlug(route) {
  return route.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-") || "root";
}

function finalPath(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "[invalid-url]";
  }
}

async function hasErrorBoundary(page) {
  return await page.getByText("We could not load this page", { exact: false }).count() > 0;
}

export function pageFailureTracker(page, route, viewport) {
  let pageError = false;
  let findings = new Map();
  page.on("pageerror", () => { pageError = true; });
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "document") return;
    const finding = subresourceFinding({
      route,
      viewport,
      url: request.url(),
      resourceType: request.resourceType(),
    });
    findings.set(`${finding.resourceType}|${finding.target}|0`, finding);
  });
  page.on("response", (response) => {
    if (response.ok() || response.request().resourceType() === "document") return;
    const finding = subresourceFinding({
      route,
      viewport,
      url: response.url(),
      resourceType: response.request().resourceType(),
      status: response.status(),
    });
    findings.set(`${finding.resourceType}|${finding.target}|${finding.status}`, finding);
  });
  return {
    get pageError() { return pageError; },
    findings() { return [...findings.values()]; },
    reset() {
      findings = new Map();
    },
  };
}

function addSafetyFailures(target, failures) {
  for (const failure of failures) {
    const key = JSON.stringify(failure);
    if (!target.some((candidate) => JSON.stringify(candidate) === key)) target.push(failure);
  }
}

function addFindings(target, findings) {
  for (const finding of findings) {
    const key = JSON.stringify(finding);
    if (!target.some((candidate) => JSON.stringify(candidate) === key)) target.push(finding);
  }
}

function assertGuard(guard, sections, route, viewport) {
  try {
    guard.assertSafe();
    return true;
  } catch {
    const blocked = guard.blocked[0] ?? { method: "[invalid-method]", target: "[invalid-url]" };
    addSafetyFailures(sections.routes.safetyFailures, [{
      kind: "blocked-method",
      route,
      viewport,
      method: blocked.method,
      target: blocked.target,
    }]);
    process.stderr.write(`Quality audit blocked a write request: ${blocked.method} ${blocked.target}\n`);
    return false;
  }
}

export async function finalizeGuardedContext({ tracker, guard, sections, route, viewport }) {
  if (tracker?.pageError) {
    addSafetyFailures(sections.routes.safetyFailures, [{ kind: "page-error", route }]);
  }
  assertGuard(guard, sections, route, viewport);
  await guard.context.close();
}

async function runScheduledAudit(browser, input) {
  const { baseUrl, cookies, item, screenshotRoot, sections, probe } = input;
  const viewport = VIEWPORT_BY_NAME.get(item.viewport);
  if (!viewport) throw new Error("Runtime schedule contains an unknown viewport");
  const guard = await createReadOnlyContext(browser, { cookies, viewport });
  input.guards.push({ guard, route: item.route, viewport: item.viewport });
  const page = await guard.context.newPage();
  const tracker = pageFailureTracker(page, item.route, item.viewport);
  let result;

  try {
    result = await auditPage(page, {
      url: `${baseUrl}${item.route}`,
      screenshotRoot,
      screenshotPath: `${routeSlug(item.route)}-${item.viewport}.png`,
    });
    const failures = navigationSafetyFailures({
      route: item.route,
      status: result.status,
      finalPath: finalPath(page),
      errorBoundary: await hasErrorBoundary(page),
      pageError: tracker.pageError,
    });
    addSafetyFailures(sections.routes.safetyFailures, failures);

    const axe = result.findings.filter((finding) => finding.kind === "axe")
      .map((finding) => ({ ...finding, route: item.route, viewport: item.viewport }));
    const viewportFindings = item.audit === "matrix"
      ? result.findings.filter((finding) => finding.kind === "viewport")
        .map((finding) => ({ ...finding, route: item.route, viewport: item.viewport }))
      : [];
    addFindings(sections.axe.findings, axe);
    addFindings(sections.viewports.findings, viewportFindings);
    if (item.audit === "matrix") {
      sections.viewports.snapshots.push({
        route: item.route,
        viewport: item.viewport,
        documentOverflow: result.viewport.documentOverflow,
        internalScrollers: result.viewport.internalScrollers,
        clippedTargets: result.viewport.clippedTargets,
        shellOverlaps: result.viewport.shellOverlaps,
        smallTargets: result.viewport.smallTargets,
      });
    }

    const subresources = tracker.findings();
    addFindings(sections.routes.findings, subresources);
    sections.routes.routes.push({
      route: item.route,
      viewport: item.viewport,
      audit: item.audit,
      status: result.status ?? 0,
      axeFindings: axe.length,
      viewportFindings: viewportFindings.length,
      failedSubresources: subresources.length,
    });

    if (probe) {
      try {
        await page.evaluate(() => fetch("/dashboard", { method: "POST" }));
      } catch {
        // The route guard is the authoritative proof; assertGuard records it below.
      }
    }
  } catch {
    addSafetyFailures(sections.routes.safetyFailures, [{
      kind: "route-audit",
      route: item.route,
      viewport: item.viewport,
    }]);
  } finally {
    await finalizeGuardedContext({ tracker, guard, sections, route: item.route, viewport: item.viewport });
  }
}

export async function navigateForPerformance(page, tracker, url, route) {
  tracker.reset();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector("#main-content", { state: "visible", timeout: 30_000 });
  const loadFinalized = await waitForLoadFinalization(page);
  await page.waitForTimeout(500);
  const safetyFailures = navigationSafetyFailures({
    route,
    status: response?.status() ?? null,
    finalPath: finalPath(page),
    errorBoundary: await hasErrorBoundary(page),
    pageError: tracker.pageError,
  });
  const snapshot = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (!navigation) return null;
    const quality = window.__oneBookQuality ?? { lcp: 0, cls: 0, interactions: [], longTasks: [], unsupported: [] };
    const resources = performance.getEntriesByType("resource");
    return {
      navigation: {
        duration: Number(navigation.duration),
        responseEnd: Number(navigation.responseEnd),
        responseStart: Number(navigation.responseStart),
        domContentLoadedEventEnd: Number(navigation.domContentLoadedEventEnd),
        loadEventEnd: Number(navigation.loadEventEnd),
        transferSize: "transferSize" in navigation ? Number(navigation.transferSize) : null,
      },
      resources: resources.map((entry) => ({
        transferSize: "transferSize" in entry ? Number(entry.transferSize) : null,
      })),
      metrics: {
        lcp: Number(quality.lcp),
        cls: Number(quality.cls),
        interactions: quality.interactions.map(Number),
        longTasks: quality.longTasks.map(Number),
        unsupported: [...quality.unsupported],
      },
    };
  });
  const sample = performanceSample(snapshot, {
    loadFinalized,
    failedSubresources: tracker.findings().length,
  });
  return {
    sample,
    safetyFailures,
    subresources: tracker.findings(),
  };
}

function addPerformanceResults(sections, route, medians) {
  const kinds = { cls: "cls" };
  for (const [metric, value] of Object.entries(medians)) {
    if (!Number.isFinite(value)) {
      sections.performance.unavailable.push({ kind: "performance", route, metric });
      continue;
    }
    sections.performance.measurements.push({
      key: `performance.${route}.${metric}`,
      kind: kinds[metric] ?? "performance",
      value,
    });
  }

  const thresholds = [
    ["responseMs", BUDGETS.informational.responseMs],
    ["lcpMs", BUDGETS.informational.lcpMs],
    ["cls", BUDGETS.informational.cls],
    ["interactionMs", BUDGETS.informational.interactionMs],
    ["longTaskMs", BUDGETS.informational.longTaskMs],
  ];
  for (const [metric, threshold] of thresholds) {
    if (Number.isFinite(medians[metric]) && medians[metric] > threshold) {
      sections.performance.findings.push({
        kind: "performance",
        rule: `${metric}-budget`,
        route,
        viewport: "desktop",
        target: "document",
        value: medians[metric],
        threshold,
      });
    }
  }
}

async function runPerformanceRoute(browser, input) {
  const { baseUrl, cookies, route, sections } = input;
  const guard = await createReadOnlyContext(browser, {
    cookies,
    viewport: VIEWPORT_BY_NAME.get("desktop"),
  });
  input.guards.push({ guard, route, viewport: "desktop" });
  const page = await guard.context.newPage();
  const tracker = pageFailureTracker(page, route, "desktop");
  const samples = [];

  try {
    await installMetricObservers(page);
    const warmup = await navigateForPerformance(page, tracker, `${baseUrl}${route}`, route);
    addSafetyFailures(sections.routes.safetyFailures, warmup.safetyFailures);
    addFindings(sections.routes.findings, warmup.subresources);
    if (!warmup.sample || warmup.safetyFailures.length) return;

    for (let index = 0; index < 3; index += 1) {
      const measured = await navigateForPerformance(page, tracker, `${baseUrl}${route}`, route);
      addSafetyFailures(sections.routes.safetyFailures, measured.safetyFailures);
      addFindings(sections.routes.findings, measured.subresources);
      if (!measured.sample || measured.safetyFailures.length) return;
      samples.push(measured.sample);
    }
    addPerformanceResults(sections, route, performanceMedians(samples));
  } catch {
    addSafetyFailures(sections.routes.safetyFailures, [{ kind: "performance-audit", route }]);
  } finally {
    await finalizeGuardedContext({ tracker, guard, sections, route, viewport: "desktop" });
  }
}

async function runKeyboardAudit(browser, input) {
  const { baseUrl, cookies, sections } = input;
  const guard = await createReadOnlyContext(browser, {
    cookies,
    viewport: VIEWPORT_BY_NAME.get("desktop"),
  });
  input.guards.push({ guard, route: "/keyboard", viewport: "keyboard" });
  const page = await guard.context.newPage();
  const tracker = pageFailureTracker(page, "/keyboard", "keyboard");

  try {
    sections.keyboard = keyboardSection(await runKeyboardScenarios(page, baseUrl));
  } catch (error) {
    if (!(error instanceof KeyboardSafetyError)) throw error;
    addSafetyFailures(sections.keyboard.safetyFailures, [{
      kind: error.kind,
      route: error.route,
      viewport: "keyboard",
    }]);
  } finally {
    addFindings(sections.routes.findings, tracker.findings());
    await finalizeGuardedContext({ tracker, guard, sections, route: "/keyboard", viewport: "keyboard" });
  }
}

export async function runRuntime(env = process.env) {
  const paths = qualityPaths(process.cwd());
  const resultsDir = paths.resultsDir;
  const screenshotRoot = join(resultsDir, "screenshots");
  mkdirSync(resultsDir, { recursive: true });
  validateOwnedDirectory(resultsDir);
  mkdirSync(screenshotRoot, { recursive: true });
  validateOwnedResultRoots(resultsDir, screenshotRoot);
  const sections = {
    axe: section({ runs: [] }),
    keyboard: keyboardSection([]),
    viewports: section({ snapshots: [] }),
    performance: section(),
    routes: section({ routes: [] }),
  };
  let browser;
  const guards = [];

  try {
    const baseUrl = resolvedBaseUrl(env.QUALITY_BASE_URL);
    const phases = runtimeAuditPhases(env.QUALITY_ONLY);
    const routes = !phases.routes
      ? []
      : selectRuntimeRoutes(discoverStaticRoutes(paths.appDir), env.QUALITY_ONLY);
    if (phases.routes && !routes.length) throw new Error("No static authenticated routes were selected");

    let authentication;
    try {
      authentication = await smokeSession(env);
    } catch {
      addSafetyFailures(sections.routes.safetyFailures, [{ kind: "auth" }]);
      process.stderr.write("Quality runtime authentication failed\n");
      return await finishRuntime(resultsDir, sections, env);
    }

    const cookies = playwrightSessionCookies({ ...authentication, appBaseUrl: baseUrl });
    browser = await chromium.launch({ headless: true });
    if (phases.keyboard) {
      await runKeyboardAudit(browser, { baseUrl, cookies, sections, guards });
    }
    if (phases.routes && !sections.keyboard.safetyFailures.length
      && !sections.routes.safetyFailures.length) {
      const schedule = runtimeSchedule(routes);
      let probe = env.QUALITY_PROBE_BLOCKED_METHOD === "1";
      for (const item of schedule) {
        await runScheduledAudit(browser, {
          baseUrl,
          cookies,
          item,
          screenshotRoot,
          sections,
          guards,
          probe,
        });
        probe = false;
        if (sections.routes.safetyFailures.some(({ kind }) => kind === "blocked-method")) break;
      }

      if (!sections.routes.safetyFailures.length) {
        for (const route of routes) {
          await runPerformanceRoute(browser, { baseUrl, cookies, route, sections, guards });
          if (sections.routes.safetyFailures.length) break;
        }
      }
    }
  } catch {
    addSafetyFailures(sections.routes.safetyFailures, [{ kind: "runtime-harness" }]);
    process.stderr.write("Quality runtime harness failed\n");
  } finally {
    for (const { guard, route, viewport } of guards) assertGuard(guard, sections, route, viewport);
    try {
      await closeRuntimeResources(browser);
    } catch {
      addSafetyFailures(sections.routes.safetyFailures, [{ kind: "cleanup" }]);
      process.stderr.write("Quality runtime cleanup failed\n");
    }
  }

  return await finishRuntime(resultsDir, sections, env);
}

async function finishRuntime(resultsDir, sections, env) {
  writeRuntimeArtifacts(resultsDir, sections);
  const mode = qualityMode(env);
  const paths = qualityPaths(process.cwd());
  const baselinePath = resolve(env.QUALITY_BASELINE_PATH ?? paths.baselinePath);
  const summary = aggregateQualityArtifacts(resultsDir, { mode, baselinePath });
  writeQualityReport(resultsDir, summary);
  const comparison = summary.comparison ?? { newFindings: [], measurementRegressions: [] };
  return qualityExitCode({ mode, comparison, safetyFailures: summary.safetyFailures });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    process.exitCode = await runRuntime();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
