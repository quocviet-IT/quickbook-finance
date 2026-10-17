import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page reached by a plain address answers a missing or stale query with a
 * way on, never with "Page not found".
 *
 * Reported 2026-10-17: /banking/reconcile/from-files opened bare (the release
 * notes link to it that way, and so does anyone who types it) said Page not
 * found, because it needs ?account= and called notFound() without one. The
 * button on the Reconcile page always carried the account, so it looked fine
 * from inside the app.
 *
 * A page with a segment of its own, such as /purchase-orders/[id], may still
 * answer an id that does not exist with notFound(): that address names one
 * record, and the record is not there.
 */
function pages(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, root, out);
    else if (entry === "page.tsx") out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("a page with no segment of its own", () => {
  const root = process.cwd();
  const all = pages(join(root, "app"), root);

  it("finds the pages it is supposed to be guarding", () => {
    expect(all).toContain("app/(app)/banking/reconcile/from-files/page.tsx");
  });

  it("never answers its query with Page not found", () => {
    const offenders = all
      .filter((file) => !/\[[^\]]+\]/.test(file))
      .filter((file) => {
        const source = readFileSync(join(root, file), "utf8");
        return source.includes("searchParams") && /\bnotFound\(\)/.test(source);
      });
    expect(offenders).toEqual([]);
  });

  it("sends Reconcile from statement files back to the account choice", () => {
    const source = readFileSync(join(root, "app/(app)/banking/reconcile/from-files/page.tsx"), "utf8");
    expect(source.match(/redirect\("\/banking\/reconcile"\)/g)).toHaveLength(2);
  });
});
