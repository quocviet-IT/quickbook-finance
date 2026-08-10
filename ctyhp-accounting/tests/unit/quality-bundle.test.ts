import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyzeBundle, parseClientReferenceManifest, summarizeRouteChunks } from "../../scripts/quality/bundle.mjs";

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
    const nextDir = resolve(dirname(fileURLToPath(import.meta.url)), "../quality/fixtures/bundle/.next");
    const report = analyzeBundle(nextDir);
    const expectedGzipBytes = ["route.js", "shared.js"]
      .map((name) => gzipSync(readFileSync(resolve(nextDir, "static/chunks", name))).byteLength)
      .reduce((total, value) => total + value, 0);
    expect(report.routes).toContainEqual(expect.objectContaining({ route: "/dashboard", gzipBytes: expectedGzipBytes }));
    expect(report.chunks).toContainEqual(expect.objectContaining({ chunk: "static/chunks/route.js", hash: expect.any(String) }));
  });

  it("refuses a manifest that references a missing browser chunk", () => {
    const source = resolve(dirname(fileURLToPath(import.meta.url)), "../quality/fixtures/bundle/.next");
    const nextDir = mkdtempSync(resolve(tmpdir(), "quality-bundle-"));
    cpSync(source, nextDir, { recursive: true });
    rmSync(resolve(nextDir, "static/chunks/route.js"));

    expect(() => analyzeBundle(nextDir)).toThrow(/referenced chunk|ENOENT/i);
  });
});
