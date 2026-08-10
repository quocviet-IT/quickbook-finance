import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyzeBundle,
  parseClientReferenceManifest,
  resolvePhysicalChunkPath,
  summarizeRouteChunks,
} from "../../scripts/quality/bundle.mjs";
import { runBundleCli } from "../../scripts/quality/run-bundle.mjs";

const fixtureNextDir = resolve(dirname(fileURLToPath(import.meta.url)), "../quality/fixtures/bundle/.next");

describe("quality bundle analyzer", () => {
  it("deduplicates route chunks from Turbopack entryJSFiles", () => {
    const text = "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n"
      + "globalThis.__RSC_MANIFEST[\"/(app)/dashboard/page\"] = "
      + JSON.stringify({ entryJSFiles: {
        "[project]/app/layout": ["static/chunks/shared.js"],
        "[project]/app/(app)/dashboard/page": ["static/chunks/shared.js", "static/chunks/route.js"],
      } }) + ";";
    const manifest = parseClientReferenceManifest(text);
    expect(summarizeRouteChunks(manifest)).toEqual(["static/chunks/route.js", "static/chunks/shared.js"]);
  });

  it("parses Turbopack manifests for dynamic route keys containing brackets", () => {
    const text = "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n"
      + "globalThis.__RSC_MANIFEST[\"/(app)/banking/reconcile/[id]/page\"] = "
      + JSON.stringify({ entryJSFiles: { "[project]/app/page": ["static/chunks/route.js"] } }) + ";";

    expect(summarizeRouteChunks(parseClientReferenceManifest(text))).toEqual(["static/chunks/route.js"]);
  });

  it("produces stable route bytes from the checked-in fixture", () => {
    const report = analyzeBundle(fixtureNextDir);

    expect(report).toEqual({
      version: 1,
      routes: [{
        route: "/dashboard",
        chunks: ["static/chunks/route.js", "static/chunks/shared.js"],
        bytes: 45,
        gzipBytes: 85,
      }],
      chunks: [
        {
          chunk: "static/chunks/route.js",
          bytes: 22,
          gzipBytes: 42,
          hash: "2ea983b65f22787ff30c70464651c68c4da582bb27d4cb9a3234efa514613faa",
          routes: ["/dashboard"],
        },
        {
          chunk: "static/chunks/shared.js",
          bytes: 23,
          gzipBytes: 43,
          hash: "570809faf60dad1e114c077b190152c063dff8b95ce90d9cecd41f7df5f0b822",
          routes: ["/dashboard"],
        },
      ],
      total: { bytes: 45, gzipBytes: 85 },
      shared: { chunks: [], bytes: 0, gzipBytes: 0 },
    });
  });

  it("refuses a manifest that references a missing browser chunk", () => {
    const nextDir = mkdtempSync(resolve(tmpdir(), "quality-bundle-"));
    cpSync(fixtureNextDir, nextDir, { recursive: true });
    rmSync(resolve(nextDir, "static/chunks/route.js"));

    expect(() => analyzeBundle(nextDir)).toThrow(/referenced chunk|ENOENT/i);
  });

  it("publishes route and chunk detail in the generated summary", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-bundle-summary-"));
    const previousCwd = process.cwd();
    try {
      cpSync(fixtureNextDir, join(root, ".next"), { recursive: true });
      process.chdir(root);
      expect(runBundleCli([".next"], { NODE_ENV: "test" })).toBe(0);

      const summary = readFileSync(join(root, ".quality-results", "summary.md"), "utf8");
      expect(summary).toContain("/dashboard");
      expect(summary).toContain("static/chunks/route.js");
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses linked chunks that resolve outside the physical chunks directory", () => {
    const nextDir = mkdtempSync(resolve(tmpdir(), "quality-bundle-link-"));
    cpSync(fixtureNextDir, nextDir, { recursive: true });
    const contained = resolve(nextDir, "static/chunks/route.js");
    expect(resolvePhysicalChunkPath(nextDir, "static/chunks/route.js")).toBe(realpathSync(contained));

    const outside = resolve(nextDir, "outside.js");
    const escape = resolve(nextDir, "static/chunks/escape.js");
    writeFileSync(outside, "console.log('outside');\n", "utf8");
    try {
      symlinkSync(outside, escape, "file");
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      return;
    }

    expect(() => resolvePhysicalChunkPath(nextDir, "static/chunks/escape.js")).toThrow(/escapes.*static.chunks/i);
  });
});
