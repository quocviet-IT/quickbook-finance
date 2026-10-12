import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ant Design used to generate every component's stylesheet at run time: on the
 * server for every request — 330–440 KB of CSS inlined into each page's HTML,
 * 60–85% of it, rebuilt each time and never cacheable (production, 12/10) — and
 * again in the browser for every component a navigation brought in.
 *
 * antd 6's zero-runtime mode takes the component styles from its prebuilt
 * antd/dist/antd.css, which the browser caches, and keeps generating only the
 * CSS variables: the theme's tokens and each component's token block. Those are
 * what carry One Book's colours, so light, dark and the per-theme `cssVar` keys
 * in providers.tsx keep working.
 *
 * Source-level, like the other shell contracts: dropping the flag or the import
 * puts the inline stylesheet back, or leaves components unstyled, and nothing
 * else here would fail.
 */
const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("Ant Design styles come from the prebuilt stylesheet", () => {
  it("the theme turns on zero-runtime mode", () => {
    expect(source("app/providers.tsx")).toMatch(/zeroRuntime: true/);
  });

  it("the root layout imports antd.css after the app's own stylesheet", () => {
    const layout = source("app/layout.tsx");
    const antd = layout.indexOf('import "antd/dist/antd.css";');
    const app = layout.indexOf('import "./globals.css";');
    expect(app).toBeGreaterThan(-1);
    // Same specificity, later wins. The generated stylesheet sat after the
    // app's CSS, so Ant Design won those ties on every approved screen; the
    // prebuilt one has to keep that place or the ties flip to the app.
    expect(antd).toBeGreaterThan(app);
  });
});
