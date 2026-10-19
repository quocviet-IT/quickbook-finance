import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every source file is UTF-8.
 *
 * A script edit once wrote the "·" in a report's subtitle as the single
 * Latin-1 byte 0xB7. The type checker read past it, the unit tests passed, and
 * the production build stopped on "invalid utf-8 sequence". This finds it
 * where the tests run instead.
 */
const ROOTS = ["app", "components", "lib", "tests"];

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (/\.(tsx?|css|mjs|json)$/.test(entry)) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("source files", () => {
  it("are all valid UTF-8", () => {
    const root = process.cwd();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const broken = ROOTS.flatMap((dir) => sourceFiles(join(root, dir), root)).filter((file) => {
      try {
        decoder.decode(readFileSync(join(root, file)));
        return false;
      } catch {
        return true;
      }
    });
    expect(broken).toEqual([]);
  });
});
