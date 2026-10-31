import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing that runs in the browser reaches a Node built-in.
 *
 * The bundler does not refuse `node:crypto` in a client module: it quietly
 * ships a polyfill instead. That is how the Banking screen came to download
 * crypto-browserify, roughly half a megabyte with its helpers, because the
 * review queue lived in the same module as the server's statement hashing; and
 * the polyfill's helpers probe `Function`, which the Content-Security-Policy
 * then reported on every visit (2.97). Hashing in the browser goes through Web
 * Crypto instead (lib/client/statement-line-keys.ts).
 *
 * Walked from every "use client" file through the imports that are bundled:
 * not `import type`, and not into a "use server" module, which the client
 * receives as a reference rather than as code.
 */
const ROOT = process.cwd();
const BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "dns", "events", "fs", "http", "https", "net", "os",
  "path", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "vm", "zlib",
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const directive = (text: string, name: string) => new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n\\s*|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${name}["']`).test(text);

/** The specifiers a module's bundled code imports. */
function bundledImports(text: string): string[] {
  const found: string[] = [];
  const statement = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of text.matchAll(statement)) if (!m[2]) found.push(m[3]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  return found;
}

function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const isBuiltin = (spec: string) => spec.startsWith("node:") || BUILTINS.has(spec.split("/")[0]);

describe("code that runs in the browser", () => {
  it("never reaches a Node built-in through its imports", () => {
    const entries = ["app", "components", "lib"]
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((path) => directive(readFileSync(path, "utf8"), "use client"));
    expect(entries.length, "client modules were found").toBeGreaterThan(50);

    // One walk over everything the client modules reach; each file is read once
    // and reported with the first chain of imports that led to it.
    const problems: string[] = [];
    const seen = new Set<string>();
    const walk = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      if (trail.length > 0 && directive(text, "use server")) return;
      for (const spec of bundledImports(text)) {
        if (isBuiltin(spec)) {
          problems.push(`${[...trail, file].map((f) => relative(ROOT, f).replace(/\\/g, "/")).join(" -> ")} imports ${spec}`);
          continue;
        }
        const next = resolveSpecifier(file, spec);
        if (next) walk(next, [...trail, file]);
      }
    };
    for (const entry of entries) walk(entry, []);
    expect(problems).toEqual([]);
  }, 30_000);

  it("finds the import this guard exists for", () => {
    // The walker sees a type-only import as erased, and a value import as bundled.
    expect(bundledImports('import type { A } from "@/x";\nimport { b } from "@/y";\nexport { c } from "./z";\nimport "./side";')).toEqual([
      "@/y",
      "./z",
      "./side",
    ]);
    expect(bundledImports('import { createHash } from "node:crypto";').map(isBuiltin)).toEqual([true]);
  });
});
