import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every fixed link a rule or a component hands out leads to a page.
 *
 * The Purchases overview linked "Payments are applied to bills" and each
 * unapplied supplier payment to /bill-payments, which has never existed: the
 * check and the button answered 404, and the browser logged it on every visit.
 * This walks the same places and fails on any `href: "/…"` with no page behind it.
 */
const ROOT = process.cwd();
const SOURCES = ["lib/domain", "components"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

// Route groups such as (app) are not part of the address; a page may sit in any of them.
const ROUTE_ROOTS = [
  join(ROOT, "app"),
  ...readdirSync(join(ROOT, "app"))
    .filter((entry) => /^\(.*\)$/.test(entry))
    .map((group) => join(ROOT, "app", group)),
];

function hasPage(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/$/, "");
  return ROUTE_ROOTS.some(
    (root) => existsSync(join(root, path, "page.tsx")) || existsSync(join(root, path, "route.ts")),
  );
}

const links = SOURCES.flatMap((directory) => sourceFiles(join(ROOT, directory))).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/href:\s*"(\/[^"]*)"/g)].map((match) => ({
    href: match[1],
    file: relative(ROOT, file).replace(/\\/g, "/"),
  })),
);

describe("fixed links", () => {
  it("are found", () => {
    expect(links.length).toBeGreaterThan(50);
  });

  it("each lead to a page", () => {
    const dead = links.filter((link) => !hasPage(link.href)).map((link) => `${link.href} in ${link.file}`);
    expect(dead).toEqual([]);
  });

  it("send unapplied supplier payments to Pay Bills, where they are listed, and say Review", () => {
    const rules = readFileSync(join(ROOT, "lib/domain/purchases-surface/rules.ts"), "utf8");
    expect(rules).not.toContain('href: "/bill-payments"');
    expect(rules).toMatch(/href: "\/pay-bills",\s*actionLabel: "Review"/);
  });
});
