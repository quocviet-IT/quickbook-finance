import { resolve } from "node:path";

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "mobile", width: 375, height: 812 }),
  Object.freeze({ name: "tablet-portrait", width: 768, height: 1024 }),
  Object.freeze({ name: "compact-desktop", width: 1024, height: 768 }),
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
]);

export const MATRIX_ROUTES = Object.freeze([
  "/dashboard", "/sales", "/invoices", "/purchases", "/bills", "/banking",
  "/accounting", "/accounts", "/reports", "/settings", "/settings/import", "/approvals",
]);

export const BUDGETS = Object.freeze({
  bundle: Object.freeze({ percent: 0.10, absoluteGzipBytes: 20 * 1024 }),
  performance: Object.freeze({ percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 }),
  informational: Object.freeze({ lcpMs: 2500, cls: 0.1, interactionMs: 200, responseMs: 1000, longTaskMs: 200 }),
});

export function qualityMode(env = process.env) {
  const mode = env.QUALITY_MODE?.trim() || "report";
  if (mode !== "report" && mode !== "regression") {
    throw new Error(`QUALITY_MODE must be report or regression; received ${mode}`);
  }
  return mode;
}

export function qualityPaths(root = process.cwd()) {
  const pathFromRoot = (...segments) => resolve(root, ...segments).replaceAll("\\", "/");

  return {
    resultsDir: pathFromRoot(".quality-results"),
    baselinePath: pathFromRoot("tests", "quality", "baseline.json"),
    appDir: pathFromRoot("app", "(app)"),
    nextDir: pathFromRoot(".next"),
  };
}
