import { describe, expect, it } from "vitest";
import {
  KEYBOARD_SCENARIOS,
  KeyboardSafetyError,
  MUTATION_LABEL_PATTERN,
  runKeyboardScenario,
  waitForVisibleLocator,
} from "../../scripts/quality/keyboard.mjs";
import {
  keyboardSection,
  runtimeAuditPhases,
} from "../../scripts/quality/run-runtime.mjs";

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

  it("reports ordinary assertions without retaining content-shaped result values", async () => {
    const scenario = {
      id: "skip-link",
      route: "/dashboard",
      viewport: { width: 1440, height: 900 },
      actions: ["Tab", "Enter"],
      run: async () => {
        throw new Error("customer@example.test Acme-Customer-123 secret input text");
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

  it("runs keyboard coverage in both the focused and full runtime plans", () => {
    expect(runtimeAuditPhases("keyboard")).toEqual({ keyboard: true, routes: false });
    expect(runtimeAuditPhases("")).toEqual({ keyboard: true, routes: true });
    expect(runtimeAuditPhases("/dashboard")).toEqual({ keyboard: true, routes: true });
  });
});
