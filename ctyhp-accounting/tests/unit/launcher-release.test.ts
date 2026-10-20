import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the help buttons release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Help buttons in one row"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("says the buttons are one row, can be hidden, and every page leaves room for them", () => {
    for (const words of ["one row", "full button at the end of the row", "On a phone they start hidden", "Room at the foot of every page"]) {
      expect(said).toContain(words);
    }
  });
});

describe("the room every page leaves for the help buttons", () => {
  // The cluster measures itself and sets the variable; the content reads it.
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const launcher = readFileSync(join(process.cwd(), "components/assistant/AssistantLauncher.tsx"), "utf8");

  it("is read by the content area from the variable the cluster sets", () => {
    expect(css).toMatch(/\.app-shell__content \{[^}]*padding-bottom: var\(--assistant-launcher-clearance, 96px\);/);
    expect(launcher).toContain('setProperty("--assistant-launcher-clearance"');
  });
});
