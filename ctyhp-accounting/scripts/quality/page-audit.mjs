import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { installMetricObservers } from "./browser.mjs";

const SAFE_TAGS = new Set([
  "a", "article", "aside", "button", "dialog", "div", "footer", "form", "header",
  "input", "label", "li", "main", "nav", "section", "select", "summary", "table",
  "tbody", "td", "textarea", "th", "thead", "tr",
]);
const SAFE_ROLES = new Set([
  "alert", "button", "checkbox", "combobox", "dialog", "grid", "gridcell", "link", "list",
  "listbox", "listitem", "main", "menu", "menuitem", "navigation", "option", "radio",
  "region", "row", "rowgroup", "search", "slider", "spinbutton", "switch", "tab", "table",
  "tabpanel", "textbox", "toolbar", "tree", "treeitem",
]);
const SAFE_TYPES = new Set([
  "button", "checkbox", "date", "datetime-local", "email", "file", "image", "month", "number",
  "password", "radio", "range", "reset", "search", "submit", "tel", "text", "time", "url", "week",
]);

function contained(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..\\`)
    && !pathFromRoot.startsWith("../")
    && !isAbsolute(pathFromRoot);
}

export function isUnsafeScreenshotEntry(entry) {
  return Boolean(entry?.isSymbolicLink?.());
}

function inspectScreenshotEntries(root, destination) {
  const segments = relative(root, destination).split(/[\\/]/).filter(Boolean);
  let current = root;
  let destinationEntry;
  for (const segment of segments) {
    current = join(current, segment);
    let entry;
    try {
      entry = lstatSync(current, { throwIfNoEntry: false });
    } catch {
      throw new Error("Screenshot destination entries could not be safely validated");
    }
    if (!entry) break;
    if (isUnsafeScreenshotEntry(entry)) {
      throw new Error("Screenshot destination must stay beneath the owned screenshot root");
    }
    if (current === destination) destinationEntry = entry;
  }
  return destinationEntry;
}

export function resolveOwnedScreenshotPath(screenshotRoot, screenshotPath) {
  if (!screenshotRoot || !screenshotPath || isAbsolute(screenshotPath)) {
    throw new Error("Screenshot destination must stay beneath the owned screenshot root");
  }
  const lexicalRoot = resolve(screenshotRoot);
  const lexicalDestination = resolve(lexicalRoot, screenshotPath);
  if (!contained(lexicalRoot, lexicalDestination)) {
    throw new Error("Screenshot destination must stay beneath the owned screenshot root");
  }
  const destinationEntry = inspectScreenshotEntries(lexicalRoot, lexicalDestination);

  let physicalRoot;
  let physicalParent;
  try {
    physicalRoot = realpathSync(lexicalRoot);
    physicalParent = realpathSync(dirname(lexicalDestination));
  } catch {
    throw new Error("Owned screenshot root and destination parent must already exist");
  }
  const physicalDestination = destinationEntry
    ? realpathSync(lexicalDestination)
    : join(physicalParent, basename(lexicalDestination));
  if (!contained(physicalRoot, physicalDestination)) {
    throw new Error("Screenshot destination must stay beneath the owned screenshot root");
  }
  return physicalDestination;
}

export function structuralTargetToken({ tagName, role, type, ordinal } = {}) {
  const normalizedTag = String(tagName ?? "").toLowerCase();
  const tag = SAFE_TAGS.has(normalizedTag) ? normalizedTag : "element";
  const normalizedRole = String(role ?? "").toLowerCase();
  const normalizedType = String(type ?? "").toLowerCase();
  const safeOrdinal = Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1;
  const roleToken = SAFE_ROLES.has(normalizedRole) ? `[role=${normalizedRole}]` : "";
  const typeToken = SAFE_TYPES.has(normalizedType) ? `[type=${normalizedType}]` : "";
  return `${tag}${roleToken}${typeToken}:nth-structural(${safeOrdinal})`;
}

function sanitizeTarget(target, ordinal) {
  return target && typeof target === "object"
    ? structuralTargetToken(target)
    : structuralTargetToken({ ordinal });
}

function viewportFinding(rule, target, value) {
  return {
    kind: "viewport",
    rule,
    target,
    ...(Number.isFinite(value) ? { value } : {}),
  };
}

export function classifyViewportSnapshot(snapshot) {
  const clippedTargets = (snapshot.clippedTargets ?? []).map((target, index) => sanitizeTarget(target, index + 1));
  const shellOverlaps = (snapshot.shellOverlaps ?? []).map((target, index) => sanitizeTarget(target, index + 1));
  const smallTargets = (snapshot.smallTargets ?? []).map((item, index) => ({
    target: sanitizeTarget(typeof item === "string" ? null : item.target, index + 1),
    ...(typeof item === "object" ? {
      width: Number(item.width),
      height: Number(item.height),
      minimum: Number(item.minimum),
    } : {}),
  }));
  const findings = [];
  if (Number(snapshot.documentOverflow) > 0) {
    findings.push(viewportFinding("document-overflow", "document", Number(snapshot.documentOverflow)));
  }
  for (const target of clippedTargets) {
    findings.push(viewportFinding("viewport-clipping", target));
  }
  for (const target of shellOverlaps) {
    findings.push(viewportFinding("fixed-shell-overlap", target));
  }
  for (const item of smallTargets) {
    findings.push(viewportFinding("target-size", item.target, item.minimum));
  }
  return { ...snapshot, clippedTargets, shellOverlaps, smallTargets, findings };
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
    const elements = [...document.querySelectorAll("*")];
    const signatureCounts = new Map();
    const descriptors = new WeakMap();
    for (const element of elements) {
      const tagName = element.tagName;
      const role = element.getAttribute("role") ?? "";
      const type = element.getAttribute("type") ?? "";
      const signature = `${tagName}\u0000${role}\u0000${type}`;
      const ordinal = (signatureCounts.get(signature) ?? 0) + 1;
      signatureCounts.set(signature, ordinal);
      descriptors.set(element, { tagName, role, type, ordinal });
    }
    const safeTarget = (element) => {
      return descriptors.get(element) ?? { tagName: "element", role: "", type: "", ordinal: 1 };
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

async function axeFindings(page, results) {
  const rawTargets = results.violations.flatMap((violation) => violation.nodes.map((node) => node.target));
  const descriptors = await page.evaluate((targets) => {
    const elements = [...document.querySelectorAll("*")];
    const describe = (element) => {
      if (!element) return null;
      const tagName = element.tagName;
      const role = element.getAttribute("role") ?? "";
      const type = element.getAttribute("type") ?? "";
      const sameSignature = elements.filter((candidate) => candidate.tagName === tagName
        && (candidate.getAttribute("role") ?? "") === role
        && (candidate.getAttribute("type") ?? "") === type);
      return { tagName, role, type, ordinal: sameSignature.indexOf(element) + 1 };
    };
    return targets.map((target) => {
      try {
        const selectors = Array.isArray(target) ? target.flat(Infinity) : [target];
        let root = document;
        let element = null;
        for (const selector of selectors) {
          if (typeof selector !== "string" || typeof root.querySelector !== "function") return null;
          element = root.querySelector(selector);
          if (!element) return null;
          root = element.shadowRoot ?? element;
        }
        return describe(element);
      } catch {
        return null;
      }
    });
  }, rawTargets);
  let nodeIndex = 0;
  const findings = [];
  for (const violation of results.violations) {
    for (let violationNodeIndex = 0; violationNodeIndex < violation.nodes.length; violationNodeIndex += 1) {
      findings.push({
        kind: "axe",
        rule: violation.id,
        impact: violation.impact ?? "unknown",
        target: structuralTargetToken(descriptors[nodeIndex] ?? { ordinal: nodeIndex + 1 }),
      });
      nodeIndex += 1;
    }
  }
  return findings;
}

export async function auditPage(page, options) {
  const {
    url,
    screenshotPath,
    screenshotRoot,
    mainSelector = "#main-content",
    navigationTimeout = 30_000,
  } = typeof options === "string" ? { url: options } : options;
  const ownedScreenshotPath = screenshotPath
    ? resolveOwnedScreenshotPath(screenshotRoot, screenshotPath)
    : null;

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

  const findings = [...await axeFindings(page, axeResults), ...viewport.findings];
  if (findings.length && ownedScreenshotPath) {
    await page.screenshot({ path: ownedScreenshotPath, fullPage: true });
  }

  return {
    status: response?.status() ?? null,
    findings,
    viewport,
    navigation: timing.navigation,
    metrics: timing.metrics,
  };
}
