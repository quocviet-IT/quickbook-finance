import { describe, expect, it } from "vitest";
import { errors as playwrightErrors } from "playwright";
import * as keyboardModule from "../../scripts/quality/keyboard.mjs";
import {
  KEYBOARD_SCENARIOS,
  KeyboardAssertionError,
  KeyboardSafetyError,
  MUTATION_LABEL_PATTERN,
  observeKeyboardSafety,
  runKeyboardScenario,
  tabTo,
  verifyFocusWrap,
  waitForKeyboardState,
  waitForVisibleLocator,
} from "../../scripts/quality/keyboard.mjs";
import {
  keyboardSection,
  runtimeAuditPhases,
} from "../../scripts/quality/run-runtime.mjs";

type PageListener = (value?: unknown) => void;

function keyboardNavigationPage(startUrl = "https://quality.example.test/dashboard") {
  const listeners = new Map<string, Set<PageListener>>();
  const mainFrame = {};
  let currentUrl = startUrl;

  const page = {
    on(name: string, listener: PageListener) {
      const eventListeners = listeners.get(name) ?? new Set<PageListener>();
      eventListeners.add(listener);
      listeners.set(name, eventListeners);
      return page;
    },
    off(name: string, listener: PageListener) {
      listeners.get(name)?.delete(listener);
      return page;
    },
    emit(name: string, value?: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(value);
    },
    mainFrame: () => mainFrame,
    url: () => currentUrl,
    waitForURL: async (predicate: (url: URL) => boolean) => {
      if (!predicate(new URL(currentUrl))) throw new Error("URL did not match");
    },
    locator: () => ({ waitFor: async () => undefined }),
    getByText: () => ({ count: async () => 0 }),
  };

  return {
    page,
    mainFrame,
    navigateTo(url: string) { currentUrl = url; },
    listenerCount(name: string) { return listeners.get(name)?.size ?? 0; },
  };
}

function documentRequest(page: ReturnType<typeof keyboardNavigationPage>, url: string) {
  return {
    method: () => "GET",
    resourceType: () => "document",
    frame: () => page.mainFrame,
    url: () => url,
  };
}

async function waitForTestKeyboardPath(
  page: ReturnType<typeof keyboardNavigationPage>,
  route: string,
  safety: ReturnType<typeof observeKeyboardSafety>,
  activate: () => Promise<void>,
) {
  const waitForKeyboardPath = (keyboardModule as unknown as {
    waitForKeyboardPath?: (
      page: ReturnType<typeof keyboardNavigationPage>["page"],
      route: string,
      safety: ReturnType<typeof observeKeyboardSafety>,
      activate: () => Promise<void>,
    ) => Promise<void>;
  }).waitForKeyboardPath;
  expect(waitForKeyboardPath).toBeTypeOf("function");
  return await waitForKeyboardPath!(page.page, route, safety, activate);
}

describe("keyboard quality scenarios", () => {
  it("names the approved stable scenarios and excludes mutation actions", () => {
    expect(KEYBOARD_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "skip-link",
      "desktop-navigation",
      "mobile-navigation",
      "account-and-new-menus",
      "global-search-focus",
      "report-center-controls",
      "guide-drawer",
      "import-controls",
    ]);
    for (const scenario of KEYBOARD_SCENARIOS) {
      expect(scenario.actions.join(" ")).not.toMatch(MUTATION_LABEL_PATTERN);
    }
  });

  it("rethrows safety failures instead of converting them into quality findings", async () => {
    const failure = new KeyboardSafetyError("blocked-method", "/dashboard");
    const scenario = {
      id: "skip-link",
      route: "/dashboard",
      viewport: { width: 1440, height: 900 },
      actions: ["Tab", "Enter"],
      run: async () => {
        throw failure;
      },
    };

    await expect(runKeyboardScenario({}, "https://quality.example.test", scenario))
      .rejects.toBe(failure);
  });

  it("reports only declared keyboard assertions without retaining content-shaped values", async () => {
    const scenario = {
      id: "skip-link",
      route: "/dashboard",
      viewport: { width: 1440, height: 900 },
      actions: ["Tab", "Enter"],
      run: async () => {
        throw new KeyboardAssertionError("customer@example.test Acme-Customer-123 secret input text");
      },
    };

    const result = await runKeyboardScenario({
      url: () => "https://quality.example.test/dashboard?customer=Acme-Customer-123",
    }, "https://quality.example.test", scenario);

    expect(result).toEqual({
      id: "skip-link",
      status: "failed",
      route: "/dashboard",
      focusedBefore: "unavailable",
      focusedAfter: "unavailable",
      message: "Keyboard assertions did not pass",
    });
    expect(JSON.stringify(result)).not.toMatch(/Acme|customer@|secret|\?/i);
  });

  it("escalates unexpected scenario exceptions as safety failures", async () => {
    const scenario = {
      id: "skip-link",
      route: "/dashboard",
      viewport: { width: 1440, height: 900 },
      actions: ["Tab", "Enter"],
      run: async () => {
        throw new Error("unexpected Playwright API failure with private content");
      },
    };

    await expect(runKeyboardScenario({
      url: () => "https://quality.example.test/dashboard?private=value",
    }, "https://quality.example.test", scenario)).rejects.toMatchObject({
      name: "KeyboardSafetyError",
      kind: "harness-error",
      route: "/dashboard",
    });
  });

  it("escalates a locator evaluation rejection instead of reporting a focus assertion", async () => {
    const evaluationFailure = new Error("Target page, context or browser has been closed");
    const skipLink = {
      count: async () => 1,
      evaluate: async () => { throw evaluationFailure; },
      filter: () => ({ first: () => skipLink }),
      waitFor: async () => undefined,
    };
    const main = {
      waitFor: async () => undefined,
    };
    const page = {
      evaluate: async () => true,
      getByText: () => ({ count: async () => 0 }),
      keyboard: { press: async () => undefined },
      locator: (selector: string) => selector === ".accounting-skip-link" ? skipLink : main,
      setViewportSize: async () => undefined,
      goto: async () => ({ status: () => 200 }),
      url: () => "https://quality.example.test/dashboard",
    };

    await expect(runKeyboardScenario(
      page,
      "https://quality.example.test",
      KEYBOARD_SCENARIOS[0],
    )).rejects.toMatchObject({
      name: "KeyboardSafetyError",
      kind: "harness-error",
      route: "/dashboard",
    });
  });

  it.each([
    ["crash", "page-crash"],
    ["close", "page-closed"],
  ])("records an unexpected page %s as a safety failure", (event, kind) => {
    const listeners = new Map<string, () => void>();
    const safety = observeKeyboardSafety({
      on: (name: string, listener: () => void) => listeners.set(name, listener),
      url: () => "https://quality.example.test/dashboard?private=value",
    });

    listeners.get(event)!();

    expect(safety.failure).toMatchObject({
      name: "KeyboardSafetyError",
      kind,
      route: "/dashboard",
    });
  });

  it("fails closed when keyboard navigation renders a 503 main document", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    const destination = "https://quality.example.test/sales?customer=private";

    const failure = await waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo(destination);
      const request = documentRequest(controlled, destination);
      controlled.page.emit("request", request);
      controlled.page.emit("response", {
        status: () => 503,
        url: () => destination,
        request: () => request,
      });
    }).catch((error) => error);
    expect(failure).toMatchObject({
      name: "KeyboardSafetyError",
      kind: "document-navigation",
      route: "/sales",
    });
    expect(String(failure)).not.toContain("customer=private");
  });

  it("fails closed when a keyboard destination document request fails", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    const destination = "https://quality.example.test/sales?token=private";

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo(destination);
      const request = documentRequest(controlled, destination);
      controlled.page.emit("request", request);
      controlled.page.emit("requestfailed", request);
    })).rejects.toMatchObject({
      name: "KeyboardSafetyError",
      kind: "document-navigation",
      route: "/sales",
    });
  });

  it("does not misclassify a failed subresource as document navigation", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo("https://quality.example.test/sales");
      controlled.page.emit("response", {
        status: () => 503,
        url: () => "https://quality.example.test/_next/static/chunk.js",
        request: () => ({
          resourceType: () => "script",
          frame: () => controlled.mainFrame,
          url: () => "https://quality.example.test/_next/static/chunk.js",
        }),
      });
    })).resolves.toBeUndefined();
    expect(safety.failure).toBeNull();
  });

  it("allows a successful SPA keyboard transition without a document response", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo("https://quality.example.test/sales");
    })).resolves.toBeUndefined();
    expect(safety.failure).toBeNull();
  });

  it("does not leak a document failure emitted before the navigation interval", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    controlled.page.emit("requestfailed", documentRequest(
      controlled,
      "https://quality.example.test/earlier?token=private",
    ));

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo("https://quality.example.test/sales");
    })).resolves.toBeUndefined();
    expect(safety.failure).toBeNull();
  });

  it("ignores a delayed response for a document request begun before the interval", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    const staleUrl = "https://quality.example.test/earlier?token=private";
    const staleRequest = documentRequest(controlled, staleUrl);
    controlled.page.emit("request", staleRequest);

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo("https://quality.example.test/sales");
      controlled.page.emit("response", {
        status: () => 503,
        url: () => staleUrl,
        request: () => staleRequest,
      });
    })).resolves.toBeUndefined();
    expect(safety.failure).toBeNull();
  });

  it("uses the final main-document response after an intermediate redirect", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    const destination = "https://quality.example.test/sales";

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo(destination);
      const redirectRequest = documentRequest(controlled, "https://quality.example.test/go-to-sales");
      controlled.page.emit("request", redirectRequest);
      controlled.page.emit("response", {
        status: () => 307,
        url: () => "https://quality.example.test/go-to-sales",
        request: () => redirectRequest,
      });
      const destinationRequest = documentRequest(controlled, destination);
      controlled.page.emit("request", destinationRequest);
      controlled.page.emit("response", {
        status: () => 200,
        url: () => destination,
        request: () => destinationRequest,
      });
    })).resolves.toBeUndefined();
    expect(safety.failure).toBeNull();
  });

  it("classifies document-observer API exceptions as harness safety failures", async () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);

    await expect(waitForTestKeyboardPath(controlled, "/sales", safety, async () => {
      controlled.navigateTo("https://quality.example.test/sales");
      controlled.page.emit("response", {
        request: () => { throw new Error("Playwright response API failed with private content"); },
      });
    })).rejects.toMatchObject({
      name: "KeyboardSafetyError",
      kind: "harness-error",
      route: "/sales",
    });
  });

  it("removes every keyboard safety listener during explicit cleanup", () => {
    const controlled = keyboardNavigationPage();
    const safety = observeKeyboardSafety(controlled.page);
    expect(controlled.listenerCount("response")).toBe(1);
    expect(controlled.listenerCount("requestfailed")).toBe(1);

    const dispose = (safety as unknown as { dispose?: () => void }).dispose;
    expect(dispose).toBeTypeOf("function");
    dispose!();

    for (const event of ["request", "response", "requestfailed", "pageerror", "crash", "close"]) {
      expect(controlled.listenerCount(event)).toBe(0);
    }

    const nextSafety = observeKeyboardSafety(controlled.page);
    expect(controlled.listenerCount("response")).toBe(1);
    nextSafety.dispose();
  });

  it("reaches a hidden file input with bounded Tab presses and no focus call", async () => {
    let focused = false;
    let focusCalls = 0;
    const pressed: string[] = [];
    const target = {
      count: async () => 1,
      evaluate: async () => focused,
      focus: async () => { focusCalls += 1; },
      waitFor: async () => undefined,
    };
    const page = {
      evaluate: async () => true,
      keyboard: {
        press: async (key: string) => {
          pressed.push(key);
          if (pressed.length === 2) focused = true;
        },
      },
    };

    await expect(tabTo(page, { first: () => target }, undefined, 3, false))
      .resolves.toBe(target);
    expect(pressed).toEqual(["Tab", "Tab"]);
    expect(focusCalls).toBe(0);
  });

  it("proves forward and reverse focus-trap wrap at structural boundaries", async () => {
    const tokens = [
      "button[role=button]:nth-structural(1)",
      "input[role=textbox][type=text]:nth-structural(1)",
      "a[role=link]:nth-structural(1)",
    ];
    let index = 0;
    const pressed: string[] = [];

    const result = await verifyFocusWrap({
      press: async (key: string) => {
        pressed.push(key);
        index = key === "Shift+Tab"
          ? (index + tokens.length - 1) % tokens.length
          : (index + 1) % tokens.length;
      },
      readToken: async () => tokens[index],
      assertInside: async () => undefined,
      assertVisible: async () => undefined,
      assertSafe: () => undefined,
    }, 6);

    expect(result).toEqual({ first: tokens[0], last: tokens[2] });
    expect(pressed).toEqual(["Tab", "Tab", "Tab", "Shift+Tab", "Tab"]);
  });

  it("serializes successful focus checkpoints from structural fields only", async () => {
    const scenario = {
      id: "skip-link",
      route: "/dashboard",
      viewport: { width: 1440, height: 900 },
      actions: ["Tab", "Enter"],
      run: async () => ({
        route: "https://quality.example.test/dashboard?token=private",
        focusedBefore: {
          tagName: "A",
          role: "link",
          type: "",
          ordinal: 2,
          id: "Acme-Customer-123",
          className: "customer-secret",
          text: "Customer One",
        },
        focusedAfter: {
          tagName: "MAIN",
          role: "main",
          type: "",
          ordinal: 1,
          id: "main-content",
        },
      }),
    };

    const result = await runKeyboardScenario({}, "https://quality.example.test", scenario);

    expect(result).toEqual({
      id: "skip-link",
      status: "passed",
      route: "/dashboard",
      focusedBefore: "a[role=link]:nth-structural(2)",
      focusedAfter: "main[role=main]:nth-structural(1)",
      message: "Keyboard assertions passed",
    });
    expect(JSON.stringify(result)).not.toMatch(/Acme|Customer One|private|main-content|\?/i);
  });

  it("keeps scenario results in keyboard.json shape and promotes only failures to findings", () => {
    const passed = {
      id: "skip-link",
      status: "passed",
      route: "/dashboard",
      focusedBefore: "a[role=link]:nth-structural(1)",
      focusedAfter: "main[role=main]:nth-structural(1)",
      message: "Keyboard assertions passed",
    };
    const failed = {
      id: "guide-drawer",
      status: "failed",
      route: "/dashboard",
      focusedBefore: "button[role=button]:nth-structural(8)",
      focusedAfter: "unavailable",
      message: "Keyboard assertions did not pass",
    };

    expect(keyboardSection([passed, failed])).toEqual({
      findings: [{
        kind: "keyboard",
        rule: "guide-drawer",
        route: "/dashboard",
        viewport: "desktop",
        target: "unavailable",
        message: "Keyboard assertions did not pass",
      }],
      measurements: [],
      unavailable: [],
      safetyFailures: [],
      scenarios: [passed, failed],
    });
  });

  it("waits for responsive targets to become visibly rendered", async () => {
    const target = {
      waitFor: async (options: unknown) => options,
    };
    const locator = {
      filter: ({ visible }: { visible: boolean }) => {
        expect(visible).toBe(true);
        return { first: () => target };
      },
    };

    await expect(waitForVisibleLocator(locator)).resolves.toBe(target);
  });

  it("classifies a missing visible keyboard target as a report-only assertion", async () => {
    const target = {
      waitFor: async () => {
        throw new playwrightErrors.TimeoutError("target stayed hidden");
      },
    };
    const locator = {
      filter: () => ({ first: () => target }),
    };

    await expect(waitForVisibleLocator(locator)).rejects.toBeInstanceOf(KeyboardAssertionError);
  });

  it("classifies an unmet Escape visibility state as a report-only assertion", async () => {
    const locator = {
      waitFor: async () => {
        throw new playwrightErrors.TimeoutError("surface stayed visible");
      },
    };

    await expect(waitForKeyboardState(locator, "hidden", "Escape did not close the surface"))
      .rejects.toBeInstanceOf(KeyboardAssertionError);
  });

  it("runs keyboard coverage in both the focused and full runtime plans", () => {
    expect(runtimeAuditPhases("keyboard")).toEqual({ keyboard: true, routes: false });
    expect(runtimeAuditPhases("")).toEqual({ keyboard: true, routes: true });
    expect(runtimeAuditPhases("/dashboard")).toEqual({ keyboard: true, routes: true });
  });
});
