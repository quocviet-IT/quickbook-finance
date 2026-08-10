import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyServiceWorkerAttempt,
  closeRuntimeResources,
  createReadOnlyContext,
  isAllowedBrowserMethod,
  safeRequestTarget,
} from "../../scripts/quality/browser.mjs";
import {
  classifyViewportSnapshot,
  isUnsafeScreenshotEntry,
  resolveOwnedScreenshotPath,
  structuralTargetToken,
} from "../../scripts/quality/page-audit.mjs";

describe("quality browser safety", () => {
  it("allows reads and refuses every write transport", () => {
    expect(isAllowedBrowserMethod("GET")).toBe(true);
    expect(isAllowedBrowserMethod("HEAD")).toBe(true);
    expect(isAllowedBrowserMethod("OPTIONS")).toBe(true);
    expect(isAllowedBrowserMethod("POST")).toBe(false);
    expect(isAllowedBrowserMethod("PUT")).toBe(false);
    expect(isAllowedBrowserMethod("PATCH")).toBe(false);
    expect(isAllowedBrowserMethod("DELETE")).toBe(false);
    expect(safeRequestTarget("https://qa.example.test/invoices?token=secret")).toBe("/invoices");
    expect(safeRequestTarget("data:text/html,<p>customer data</p>")).toBe("[non-http-url]");
  });

  it("permits an internal table scroller but reports document overflow", () => {
    expect(classifyViewportSnapshot({
      documentOverflow: 0,
      internalScrollers: 1,
      clippedTargets: [],
      shellOverlaps: [],
    }).findings).toHaveLength(0);
    expect(classifyViewportSnapshot({
      documentOverflow: 14,
      internalScrollers: 1,
      clippedTargets: [],
      shellOverlaps: [],
    }).findings[0].rule).toBe("document-overflow");
    expect(classifyViewportSnapshot({
      documentOverflow: 0,
      internalScrollers: 0,
      clippedTargets: [],
      shellOverlaps: ["#primary-action"],
    }).findings[0].rule).toBe("fixed-shell-overlap");
  });

  it("uses structural target tokens without customer-shaped ids or classes", () => {
    const token = structuralTargetToken({
      tagName: "INPUT",
      role: "textbox",
      type: "text",
      ordinal: 2,
      id: "Acme-Customer-123",
      className: "Acme-Customer-secret",
    });

    expect(token).toBe("input[role=textbox][type=text]:nth-structural(2)");
    expect(token).not.toContain("Acme");
  });

  it("rejects absolute and traversal screenshot destinations", () => {
    const temporary = mkdtempSync(join(tmpdir(), "quality-screenshots-"));
    const root = join(temporary, "owned");
    mkdirSync(root);
    try {
      expect(resolveOwnedScreenshotPath(root, "finding.png")).toBe(join(root, "finding.png"));
      expect(() => resolveOwnedScreenshotPath(root, "../escape.png")).toThrow(/owned screenshot root/);
      expect(() => resolveOwnedScreenshotPath(root, resolve(temporary, "absolute.png"))).toThrow(/owned screenshot root/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("rejects a screenshot destination whose physical parent escapes through a link", () => {
    const temporary = mkdtempSync(join(tmpdir(), "quality-screenshots-link-"));
    const root = join(temporary, "owned");
    const outside = join(temporary, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "linked"), "junction");
    try {
      expect(() => resolveOwnedScreenshotPath(root, "linked/finding.png")).toThrow(/owned screenshot root/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("classifies a successful service-worker registration as unsafe after readiness times out", () => {
    expect(classifyServiceWorkerAttempt({
      registered: true,
      ready: false,
      bypassEstablished: false,
    })).toBe("registration-succeeded");
    expect(classifyServiceWorkerAttempt({
      registered: false,
      ready: false,
      bypassEstablished: false,
    })).toBe("blocked");
  });

  it("classifies link entries as unsafe even when their targets do not exist", () => {
    expect(isUnsafeScreenshotEntry({ isSymbolicLink: () => true })).toBe(true);
    expect(isUnsafeScreenshotEntry({ isSymbolicLink: () => false })).toBe(false);
  });

  it("rejects a dangling destination link when the platform permits creating one", () => {
    const temporary = mkdtempSync(join(tmpdir(), "quality-screenshots-dangling-"));
    const root = join(temporary, "owned");
    const destination = join(root, "finding.png");
    mkdirSync(root);
    try {
      try {
        symlinkSync(join(temporary, "missing-outside.png"), destination, "file");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (["EACCES", "EPERM", "ENOTSUP"].includes(code)) return;
        throw error;
      }
      expect(() => resolveOwnedScreenshotPath(root, "finding.png")).toThrow(/owned screenshot root/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("closes a new context when cookie setup fails", async () => {
    let closeCalls = 0;
    const context = {
      addInitScript: async () => undefined,
      addCookies: async () => { throw new Error("cookie setup failed"); },
      route: async () => undefined,
      close: async () => { closeCalls += 1; },
    };
    const browser = { newContext: async () => context };
    const createContextWithCookies = createReadOnlyContext as unknown as (
      candidate: typeof browser,
      options: { cookies: Array<{ name: string }> },
    ) => Promise<unknown>;

    await expect(createContextWithCookies(browser, { cookies: [{ name: "session" }] })).rejects.toThrow("cookie setup failed");
    expect(closeCalls).toBe(1);
  });

  it("closes a new context when route setup fails", async () => {
    let closeCalls = 0;
    const context = {
      addInitScript: async () => undefined,
      addCookies: async () => undefined,
      route: async () => { throw new Error("route setup failed"); },
      close: async () => { closeCalls += 1; },
    };
    const browser = { newContext: async () => context };

    await expect(createReadOnlyContext(browser)).rejects.toThrow("route setup failed");
    expect(closeCalls).toBe(1);
  });

  it("closes the server even when browser cleanup rejects", async () => {
    const calls: string[] = [];
    const browser = {
      close: async () => {
        calls.push("browser");
        throw new Error("browser close failed");
      },
    };
    const server = {
      listening: true,
      close(callback: (error?: Error) => void) {
        calls.push("server");
        callback();
      },
    };

    await expect(closeRuntimeResources(browser, server)).rejects.toThrow("browser close failed");
    expect(calls).toEqual(["browser", "server"]);
  });
});
