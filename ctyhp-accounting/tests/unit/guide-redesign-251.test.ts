import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

describe("the System guide drawer (2.51)", () => {
  const drawer = read("components/guide/SystemGuideDrawer.tsx");

  it("has four tabs: this screen, workflows, what's new and about", () => {
    for (const label of ['text="This screen"', 'text="Workflows"', `text="What's new"`, 'text="About OneBook"']) {
      expect(drawer).toContain(label);
    }
  });

  it("lists workflows under the areas, and says the version and the date it was released", () => {
    expect(drawer).toMatch(/GUIDE_AREAS\.map\(\(area\) =>/);
    expect(drawer).toContain("OneBook {GUIDE_VERSION} · updated {formatDate(latest.date)}");
  });

  it("says which books are open", () => {
    expect(drawer).toContain("companyNotice(company)");
    expect(drawer).toContain("Sample company: ${company?.name}");
    expect(drawer).toContain("Live books: ${company?.name}");
  });

  it("is given the open company by the shell", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toMatch(/<AssistantLauncher\s+company=\{/);
    const launcher = read("components/assistant/AssistantLauncher.tsx");
    expect(launcher).toContain("company={company}");
  });
});

describe("the guide's code", () => {
  it("arrives on the first press of Guide, not with every page", () => {
    const launcher = read("components/assistant/AssistantLauncher.tsx");
    expect(launcher).toContain('dynamic(() => import("@/components/guide/SystemGuideDrawer"), { ssr: false })');
    expect(launcher).not.toMatch(/^import SystemGuideDrawer from/m);
    expect(launcher).toMatch(/\{guideOpen \|\| guideMounted \? \(\s*<SystemGuideDrawer/);
  });
});

describe("the help buttons while a panel is open", () => {
  it("step out of sight but keep their room", () => {
    const launcher = read("components/assistant/AssistantLauncher.tsx");
    expect(launcher).toContain('guideOpen || askOpen ? " assistant-launcher--behind-panel" : ""');
    const css = read("app/globals.css");
    expect(css).toMatch(/\.assistant-launcher--behind-panel \{\s*visibility: hidden;\s*pointer-events: none;\s*\}/);
  });
});

describe("the 2.51 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.51")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed and dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.51);
    expect(release.date).toBe("2026-10-24");
  });

  it("says what the guide now holds and what it stopped saying", () => {
    for (const words of [
      "four tabs",
      "groups all 16 by area",
      "numbered steps naming the button and the page it is on",
      "no longer calls this version 1",
      "invented, in a sample company, or real records, in live books",
      "stay out of sight while the guide or Ask AI is open",
    ]) {
      expect(said).toContain(words);
    }
  });
});
