import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the header gap release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Company list and search kept apart"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-19");
  });

  it("says what ran into what, and what the search field says where it is narrow", () => {
    for (const words of ["sat on top of the search field", "Search…", "Search invoices, bills, contacts…"]) {
      expect(said).toContain(words);
    }
  });
});

describe("the header's company list", () => {
  // The list's box shrank below the 230px list inside it and the list spilled
  // onto the search field. The company box must not shrink; the search gives way.
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("keeps its width, so the search field is what gives way", () => {
    const rule = css.match(/\n\.app-shell__header-company \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/flex:\s*0 0 auto;/);
  });
});
