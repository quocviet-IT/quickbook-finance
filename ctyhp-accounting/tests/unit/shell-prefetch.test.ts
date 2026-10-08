import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every full page load used to set off about seventeen background requests,
 * one per sidebar link in view: Next prefetches a visible <Link>, and for a
 * dynamic route that prefetch runs the proxy and the signed-in layout on the
 * server — its sign-in check and database calls — for a page nobody had asked
 * for (measured on production, 08/10). The shell's links now prefetch on intent
 * instead: pointer over the link, keyboard focus on it, or a finger on it.
 *
 * Source-level, like the other shell contracts: the change is which component
 * renders the links, and a plain <Link> slipping back in restores the storm
 * without failing anything else.
 */
const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("the app shell's links prefetch on intent, not on sight", () => {
  it("AppShell renders its links through IntentLink, not next/link", () => {
    const shell = source("components/AppShell.tsx");
    expect(shell).not.toMatch(/from\s+["']next\/link["']/);
    expect(shell).toMatch(/import IntentLink from "\.\/IntentLink"/);
    expect(shell).not.toMatch(/<Link[\s>]/);
  });

  it("IntentLink keeps prefetch off until a pointer, focus or touch shows intent", () => {
    const link = source("components/IntentLink.tsx");
    expect(link).toMatch(/prefetch=\{intent \? \(prefetch \?\? null\) : false\}/);
    for (const event of ["onMouseEnter", "onFocus", "onTouchStart"]) {
      expect(link, `${event} must mark intent`).toMatch(new RegExp(`${event}=\\{\\(event\\) => \\{\\s*setIntent\\(true\\);`));
    }
  });
});
