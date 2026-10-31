import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Code that can run in the browser takes zod from lib/zod.ts, which turns off
 * zod's `Function` probe there. Imported straight from "zod", the first parse
 * on a page tries `Function("")` and the Content-Security-Policy reports it
 * (2.95). Server-only files under app/ (actions, pages) may import it directly.
 */
const ROOTS = ["lib", "components"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("zod in code that reaches the browser", () => {
  it("comes from @/lib/zod, never from zod itself", () => {
    const direct = ROOTS.flatMap((root) => files(join(process.cwd(), root)))
      .filter((path) => relative(process.cwd(), path).replace(/\\/g, "/") !== "lib/zod.ts")
      .filter((path) => /from\s+["']zod(\/[^"']*)?["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path).replace(/\\/g, "/"));
    expect(direct).toEqual([]);
  });

  it("switches the probe off only where there is a window", () => {
    const source = readFileSync(join(process.cwd(), "lib/zod.ts"), "utf8");
    expect(source).toMatch(/if \(typeof window !== "undefined"\) z\.config\(\{ jitless: true \}\);/);
  });
});
