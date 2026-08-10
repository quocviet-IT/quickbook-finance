import { isAllowedBrowserMethod, safeRequestTarget } from "./browser.mjs";
import { errors as playwrightErrors } from "playwright";

const DESKTOP = Object.freeze({ width: 1440, height: 900 });
const MOBILE = Object.freeze({ width: 375, height: 812 });

export const MUTATION_LABEL_PATTERN = /\b(?:add|approve|create|delete|edit|import|issue|pay|post|record|remove|run|save|send|submit|upload|void)\b/i;

export class KeyboardSafetyError extends Error {
  constructor(kind, route) {
    super(`Keyboard safety failure: ${kind} on ${safeRoute(route)}`);
    this.name = "KeyboardSafetyError";
    this.kind = kind;
    this.route = safeRoute(route);
  }
}

export class KeyboardAssertionError extends Error {
  constructor(message = "Keyboard assertion failed") {
    super(message);
    this.name = "KeyboardAssertionError";
  }
}

function assertion(condition, message = "Keyboard assertion failed") {
  if (!condition) throw new KeyboardAssertionError(message);
}

function safeToken(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,31}$/.test(normalized) ? normalized : fallback;
}

function safeRoute(value, fallback = "/dashboard") {
  try {
    const pathname = new URL(String(value), "http://quality.invalid").pathname;
    return pathname.startsWith("/") ? pathname : fallback;
  } catch {
    return fallback;
  }
}

function structuralFocusTarget(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "unavailable";
  const tag = safeToken(snapshot.tagName, "element");
  const role = safeToken(snapshot.role, "");
  const type = safeToken(snapshot.type, "");
  const ordinal = Number.isInteger(snapshot.ordinal) && snapshot.ordinal > 0
    ? snapshot.ordinal
    : 1;
  return `${tag}${role ? `[role=${role}]` : ""}${type ? `[type=${type}]` : ""}:nth-structural(${ordinal})`;
}

function resultFor(scenario, status, evidence = {}, page) {
  const observedRoute = evidence.route ?? page?.url?.() ?? scenario.route;
  return {
    id: scenario.id,
    status,
    route: safeRoute(observedRoute, scenario.route),
    focusedBefore: structuralFocusTarget(evidence.focusedBefore),
    focusedAfter: structuralFocusTarget(evidence.focusedAfter),
    message: status === "passed"
      ? "Keyboard assertions passed"
      : "Keyboard assertions did not pass",
  };
}

function activeFocusSnapshot(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const tagName = element.tagName.toLowerCase();
    const explicitRole = element.getAttribute("role") ?? "";
    const implicitRole = tagName === "a"
      ? "link"
      : tagName === "button"
        ? "button"
        : tagName === "main"
          ? "main"
          : tagName === "select"
            ? "combobox"
            : tagName === "input"
              ? (element.getAttribute("type") === "radio" ? "radio" : "textbox")
              : "";
    const role = explicitRole || implicitRole;
    const type = tagName === "input" ? (element.getAttribute("type") ?? "text") : "";
    const peers = [...document.querySelectorAll(tagName)].filter((candidate) => {
      const candidateRole = candidate.getAttribute("role") ?? "";
      const candidateType = tagName === "input" ? (candidate.getAttribute("type") ?? "text") : "";
      return candidateRole === explicitRole && candidateType === type;
    });
    return {
      tagName,
      role,
      type,
      ordinal: Math.max(1, peers.indexOf(element) + 1),
    };
  });
}

async function focusIsVisible(page) {
  return await page.evaluate(() => document.activeElement instanceof HTMLElement
    && document.activeElement.matches(":focus-visible"));
}

async function activeIs(page, locator) {
  if (await locator.count() === 0) return false;
  return await locator.evaluate((element) => document.activeElement === element);
}

export async function waitForVisibleLocator(locator) {
  const target = locator.filter({ visible: true }).first();
  try {
    await target.waitFor({ state: "visible", timeout: 5_000 });
  } catch (error) {
    if (error instanceof playwrightErrors.TimeoutError) {
      throw new KeyboardAssertionError("The keyboard target is not visible");
    }
    throw error;
  }
  return target;
}

export async function waitForKeyboardState(locator, state, message, timeout = 5_000) {
  try {
    await locator.waitFor({ state, timeout });
  } catch (error) {
    if (error instanceof playwrightErrors.TimeoutError) {
      throw new KeyboardAssertionError(message);
    }
    throw error;
  }
}

export async function tabTo(page, locator, safety, limit = 180, requireVisible = true) {
  const target = requireVisible
    ? await waitForVisibleLocator(locator)
    : locator.first();
  if (!requireVisible) {
    try {
      await target.waitFor({ state: "attached", timeout: 5_000 });
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new KeyboardAssertionError("The keyboard target is not present");
      }
      throw error;
    }
  }
  for (let index = 0; index < limit; index += 1) {
    assertSafety(safety);
    if (await activeIs(page, target)) {
      assertion(await focusIsVisible(page), "The focused target does not match :focus-visible");
      return target;
    }
    await page.keyboard.press("Tab");
  }
  throw new KeyboardAssertionError("The target was not reached in logical Tab order");
}

async function assertFocused(page, locator) {
  assertion(await activeIs(page, locator), "Keyboard focus did not reach the expected target");
  assertion(await focusIsVisible(page), "The focused target does not match :focus-visible");
}

async function assertActiveFocusVisible(page) {
  assertion(await focusIsVisible(page), "The active element does not match :focus-visible");
}

function observedPageRoute(page) {
  try {
    return safeRoute(page?.url?.());
  } catch {
    return "/dashboard";
  }
}

export function observeKeyboardSafety(page) {
  const state = { failure: null, completed: false };
  const fail = (kind, route = observedPageRoute(page)) => {
    if (!state.failure) state.failure = new KeyboardSafetyError(kind, route);
  };
  page.on("request", (request) => {
    if (state.failure || isAllowedBrowserMethod(request.method())) return;
    state.failure = new KeyboardSafetyError(
      `blocked-${String(request.method()).toLowerCase()}`,
      safeRequestTarget(request.url()),
    );
  });
  page.on("pageerror", () => fail("page-error"));
  page.on("crash", () => fail("page-crash"));
  page.on("close", () => {
    if (!state.completed) fail("page-closed");
  });
  return state;
}

function assertSafety(state) {
  if (state?.failure) throw state.failure;
}

async function assertRendered(page, route, response, safety) {
  assertSafety(safety);
  const status = response?.status?.();
  if (Number.isInteger(status) && (status < 200 || status >= 300)) {
    throw new KeyboardSafetyError("document-navigation", route);
  }
  if (safeRoute(page.url()) === "/login") throw new KeyboardSafetyError("auth", route);
  if (await page.getByText("We could not load this page", { exact: false }).count()) {
    throw new KeyboardSafetyError("error-boundary", route);
  }
}

async function navigate(page, baseUrl, route, viewport, safety) {
  await page.setViewportSize(viewport);
  let response;
  try {
    response = await page.goto(new URL(route, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.locator("#main-content").waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    assertSafety(safety);
    throw new KeyboardSafetyError("navigation-render", route);
  }
  await assertRendered(page, route, response, safety);
}

async function waitForPath(page, route, safety) {
  try {
    await page.waitForURL((url) => url.pathname === route, { timeout: 30_000 });
    await page.locator("#main-content").waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    assertSafety(safety);
    throw new KeyboardSafetyError("navigation-render", route);
  }
  await assertRendered(page, route, null, safety);
}

async function visibleDialog(page) {
  return await waitForVisibleLocator(page.getByRole("dialog"));
}

async function assertFocusInside(page, container) {
  assertion(await container.evaluate((element) => element.contains(document.activeElement)),
    "Focus escaped the open modal surface");
  await assertActiveFocusVisible(page);
}

export async function verifyFocusWrap(driver, limit = 80) {
  const first = await driver.readToken();
  assertion(first && first !== "unavailable", "The first focus boundary is unavailable");
  let last = null;

  for (let index = 0; index < limit; index += 1) {
    await driver.press("Tab");
    driver.assertSafe();
    await driver.assertInside();
    await driver.assertVisible();
    const current = await driver.readToken();
    if (current === first) {
      assertion(last !== null, "The focus trap did not traverse a distinct element");
      await driver.press("Shift+Tab");
      driver.assertSafe();
      await driver.assertInside();
      await driver.assertVisible();
      assertion(await driver.readToken() === last,
        "Shift+Tab did not wrap from the first to the last focus boundary");
      await driver.press("Tab");
      driver.assertSafe();
      await driver.assertInside();
      await driver.assertVisible();
      assertion(await driver.readToken() === first,
        "Tab did not wrap from the last to the first focus boundary");
      return { first, last };
    }
    last = current;
  }

  throw new KeyboardAssertionError("Focus did not wrap within the bounded drawer traversal");
}

async function assertDrawerFocusWrap(page, drawer, safety) {
  return await verifyFocusWrap({
    press: async (key) => await page.keyboard.press(key),
    readToken: async () => structuralFocusTarget(await activeFocusSnapshot(page)),
    assertInside: async () => await assertFocusInside(page, drawer),
    assertVisible: async () => await assertActiveFocusVisible(page),
    assertSafe: () => assertSafety(safety),
  });
}

async function openAndCloseMenu(page, trigger, safety) {
  await assertFocused(page, trigger);
  await page.keyboard.press("Enter");
  assertSafety(safety);
  const menu = await waitForVisibleLocator(page.locator(".ant-dropdown [role=menu]"));
  await page.keyboard.press("Escape");
  await waitForKeyboardState(menu, "hidden", "Escape did not close the menu");
  assertSafety(safety);
  await assertFocused(page, trigger);
}

async function skipLinkScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", DESKTOP, safety);
  const skip = await waitForVisibleLocator(page.locator(".accounting-skip-link"));
  await page.keyboard.press("Tab");
  await assertFocused(page, skip);
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.press("Enter");
  const main = page.locator("#main-content");
  await assertFocused(page, main);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function desktopNavigationScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", DESKTOP, safety);
  const salesGroup = await tabTo(
    page,
    page.getByRole("menuitem", { name: /^Sales\b/ }),
    safety,
  );
  await page.keyboard.press("Enter");
  assertion(await salesGroup.getAttribute("aria-expanded") === "true",
    "Keyboard activation did not expand the Sales navigation group");
  await tabTo(
    page,
    page.locator('[aria-label="Primary navigation"] a[href="/sales"]'),
    safety,
  );
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.press("Enter");
  await waitForPath(page, "/sales", safety);
  await assertActiveFocusVisible(page);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function mobileNavigationScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", MOBILE, safety);
  const trigger = await tabTo(page, page.locator('[aria-label="Open navigation"]'), safety);
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.press("Enter");
  const drawer = await visibleDialog(page);
  await tabTo(page, drawer.getByRole("button", { name: "Close" }), safety, 10);
  await assertFocusInside(page, drawer);
  await assertDrawerFocusWrap(page, drawer, safety);
  await page.keyboard.press("Escape");
  await waitForKeyboardState(drawer, "hidden", "Escape did not close mobile navigation");
  assertSafety(safety);
  await assertFocused(page, trigger);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function accountAndNewMenusScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", DESKTOP, safety);
  const account = await tabTo(page, page.locator('[aria-label^="Open account menu for "]'), safety);
  const focusedBefore = await activeFocusSnapshot(page);
  await openAndCloseMenu(page, account, safety);
  const createTrigger = await tabTo(page, page.locator('[aria-label="Create new transaction"]'), safety);
  await openAndCloseMenu(page, createTrigger, safety);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function globalSearchScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", DESKTOP, safety);
  const search = await tabTo(page, page.locator('[aria-label="Search documents and contacts"]'), safety);
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.type("q");
  assertion(await search.inputValue() === "q", "Global search did not accept one keyboard character");
  assertSafety(safety);
  await page.keyboard.press("Escape");
  assertion(await search.inputValue() === "", "Escape did not clear global search");
  await assertFocused(page, search);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function reportCenterScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/reports", MOBILE, safety);
  await tabTo(page, page.locator('[aria-label="Search reports"]'), safety);
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.type("cash");
  await waitForKeyboardState(
    page.getByRole("heading", { name: "Search results" }),
    "visible",
    "Report results did not update after keyboard search",
  );
  const countText = page.getByText(/^\d+ reports? found$/);
  assertion(await countText.count() > 0, "Report results did not update after keyboard search");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const categoryLocator = page.locator('[aria-label="Report category"]');
  await waitForVisibleLocator(categoryLocator);
  const category = await tabTo(page, categoryLocator, safety);
  await page.keyboard.press("ArrowDown");
  const firstActive = await category.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  const secondActive = await category.getAttribute("aria-activedescendant");
  assertion(Boolean(secondActive) && secondActive !== firstActive,
    "Arrow keys did not move through report categories");
  await page.keyboard.press("Escape");
  await assertFocused(page, category);
  assertSafety(safety);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function guideDrawerScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/dashboard", DESKTOP, safety);
  const trigger = await tabTo(page, page.locator('[aria-label^="System guide"]'), safety);
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.press("Enter");
  const drawer = await visibleDialog(page);
  await tabTo(page, drawer.getByRole("button", { name: "Close" }), safety, 20);
  await assertFocusInside(page, drawer);
  await assertDrawerFocusWrap(page, drawer, safety);
  await page.keyboard.press("Escape");
  await waitForKeyboardState(drawer, "hidden", "Escape did not close the guide drawer");
  assertSafety(safety);
  await assertFocused(page, trigger);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

async function importControlsScenario(page, baseUrl, safety) {
  await navigate(page, baseUrl, "/settings/import", DESKTOP, safety);
  const selectedType = await tabTo(
    page,
    page.getByRole("radio", { checked: true }),
    safety,
    180,
    false,
  );
  const focusedBefore = await activeFocusSnapshot(page);
  await page.keyboard.press("ArrowRight");
  const movedType = page.getByRole("radio", { checked: true }).first();
  const arrowMoved = !(await activeIs(page, selectedType)) && await activeIs(page, movedType);
  if (arrowMoved) await assertFocused(page, movedType);
  const fileInput = page.locator('input[type="file"][accept*=".csv"]').first();
  const fileControl = await tabTo(page, page.getByRole("button", { name: "Choose a CSV file" }), safety);
  assertion(await fileInput.count() > 0,
    "The CSV file input is not present");
  await assertFocused(page, fileControl);
  await tabTo(page, fileInput, safety, 20, false);
  assertion(arrowMoved, "Arrow keys did not move through file types");
  assertSafety(safety);
  return { route: page.url(), focusedBefore, focusedAfter: await activeFocusSnapshot(page) };
}

export const KEYBOARD_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "skip-link",
    route: "/dashboard",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab to the skip link", "Enter to move to main content"]),
    run: skipLinkScenario,
  }),
  Object.freeze({
    id: "desktop-navigation",
    route: "/dashboard",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab through primary navigation", "Enter on Sales"]),
    run: desktopNavigationScenario,
  }),
  Object.freeze({
    id: "mobile-navigation",
    route: "/dashboard",
    viewport: MOBILE,
    actions: Object.freeze(["Tab to navigation trigger", "Enter to open drawer", "Escape to close drawer"]),
    run: mobileNavigationScenario,
  }),
  Object.freeze({
    id: "account-and-new-menus",
    route: "/dashboard",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab to account trigger", "Enter then Escape", "Tab to New trigger", "Enter then Escape"]),
    run: accountAndNewMenusScenario,
  }),
  Object.freeze({
    id: "global-search-focus",
    route: "/dashboard",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab to global search", "Type one character", "Escape to clear"]),
    run: globalSearchScenario,
  }),
  Object.freeze({
    id: "report-center-controls",
    route: "/reports",
    viewport: MOBILE,
    actions: Object.freeze(["Tab to report search", "Type a local filter", "Use category arrow keys", "Escape to close"]),
    run: reportCenterScenario,
  }),
  Object.freeze({
    id: "guide-drawer",
    route: "/dashboard",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab to guide trigger", "Enter to open drawer", "Tab within drawer", "Escape to close drawer"]),
    run: guideDrawerScenario,
  }),
  Object.freeze({
    id: "import-controls",
    route: "/settings/import",
    viewport: DESKTOP,
    actions: Object.freeze(["Tab to file type choices", "Use arrow keys", "Tab to CSV chooser"]),
    run: importControlsScenario,
  }),
]);

export async function runKeyboardScenario(page, baseUrl, scenario, safety) {
  try {
    const evidence = await scenario.run(page, baseUrl, safety);
    assertSafety(safety);
    return resultFor(scenario, "passed", evidence, page);
  } catch (error) {
    if (error instanceof KeyboardSafetyError) throw error;
    assertSafety(safety);
    if (error instanceof KeyboardAssertionError) {
      return resultFor(scenario, "failed", {}, page);
    }
    throw new KeyboardSafetyError("harness-error", observedPageRoute(page));
  }
}

export async function runKeyboardScenarios(page, baseUrl) {
  const safety = observeKeyboardSafety(page);
  const results = [];
  for (const scenario of KEYBOARD_SCENARIOS) {
    results.push(await runKeyboardScenario(page, baseUrl, scenario, safety));
  }
  assertSafety(safety);
  safety.completed = true;
  return results;
}
