import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  compareVersions,
  RELEASES,
  releasesSince,
} from "@/lib/domain/changelog";

/** Every static route the app serves, read from the route folders. */
function appRoutes(dir = join(process.cwd(), "app", "(app)"), prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("[")) continue;
      if (entry.startsWith("(")) {
        routes.push(...appRoutes(full, prefix));
        continue;
      }
      routes.push(...appRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix || "/");
    }
  }
  return routes;
}

describe("compareVersions", () => {
  it("reads a version as numbers, not as a string", () => {
    // "1.10" < "1.9" as text. A year from now that is why the panel stopped
    // appearing, and nobody would remember to look here.
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.9", "1.10")).toBeLessThan(0);
  });

  it("orders the ordinary cases", () => {
    expect(compareVersions("1.1", "1.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1", "1.1")).toBe(0);
  });

  it("treats a missing part as zero", () => {
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1.1.1", "1.1")).toBeGreaterThan(0);
  });
});

describe("releasesSince", () => {
  it("shows everything to a browser that has read nothing", () => {
    expect(releasesSince(null)).toEqual(RELEASES);
  });

  it("shows nothing once the newest release has been read", () => {
    expect(releasesSince(APP_VERSION)).toEqual([]);
  });

  it("shows only what came after the version they last read", () => {
    const oldest = RELEASES[RELEASES.length - 1].version;
    const since = releasesSince(oldest);
    expect(since).toHaveLength(RELEASES.length - 1);
    expect(since.some((release) => release.version === oldest)).toBe(false);
  });

  it("shows everything when the stored version is one we do not publish", () => {
    // An unknown marker proves nothing about what they have read.
    expect(releasesSince("0.9-something")).toEqual(RELEASES);
  });

  it("keeps the newest first, which is the order they are read in", () => {
    const since = releasesSince(null);
    for (let i = 1; i < since.length; i++) {
      expect(compareVersions(since[i - 1].version, since[i].version)).toBeGreaterThan(0);
    }
  });
});

describe("RELEASES", () => {
  it("names the current version as the newest one", () => {
    expect(APP_VERSION).toBe(RELEASES[0].version);
  });

  it("has unique versions in descending order", () => {
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    }
  });

  it("dates every release", () => {
    for (const release of RELEASES) expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says something in every entry", () => {
    for (const release of RELEASES) {
      expect(release.headline.length, `${release.version} has no headline`).toBeGreaterThan(15);
      expect(release.changes.length, `${release.version} lists no changes`).toBeGreaterThan(0);
      for (const change of release.changes) {
        expect(change.title.trim()).not.toBe("");
        expect(["added", "changed", "fixed"]).toContain(change.kind);
      }
    }
  });

  it("says the restored copy carries taxpayer identification numbers", () => {
    // Scoped to the specific "Restore a snapshot as a new company" entry, so
    // this fails only if that entry drops the fact — not if the phrase
    // happens to survive somewhere unrelated in the file.
    // Found by its own title across every release, not by a version number:
    // the number this shipped under moved once already when the branch was
    // brought up to date with main, and a test that breaks on a renumber is
    // guarding the wrong thing.
    const change = RELEASES.flatMap((r) => r.changes).find(
      (c) => c.title === "Restore a snapshot as a new company",
    );
    expect(change, "no 'Restore a snapshot as a new company' entry in any release").toBeDefined();
    expect(change?.detail ?? "").toMatch(/taxpayer identification/i);
  });

  it("tells the reader two exports of the same books now come back identical", () => {
    // Ties to the specific fix entry by its route, not a text search over the
    // whole release, so renaming or deleting this particular change (the
    // production edit that matters) is what makes this fail.
    const change = RELEASES.flatMap((r) => r.changes).find(
      (c) => c.route === "/settings/company" && /identical/i.test(c.title),
    );
    expect(change, "no /settings/company change about identical exports").toBeDefined();
    expect(change?.title ?? "").toMatch(/identical/i);
    expect(change?.detail ?? "").toMatch(/declared order|fixed reading order|fixed order/i);
  });

  it("only points at screens the app actually serves", () => {
    // A changelog that links to a renamed page is worse than one with no links.
    const served = new Set(appRoutes());
    // A query string is part of a real destination — `/accounting?mode=close`
    // is a page somebody can link to — so what has to exist is the path.
    const pathOf = (route: string) => route.split("?")[0];
    const missing = RELEASES.flatMap((release) =>
      release.changes.map((change) => change.route).filter((route): route is string => !!route),
    ).filter((route) => !served.has(pathOf(route)));
    expect(missing, `changelog links to pages that do not exist: ${missing.join(", ")}`).toEqual([]);
  });
});
