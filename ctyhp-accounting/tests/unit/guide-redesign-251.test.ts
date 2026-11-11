import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES, compareVersions } from "@/lib/domain/changelog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/**
 * 2.51 redesigned the guide as a drawer with four tabs. In 3.0.17 the drawer
 * became the /guide page (tests/unit/guide-page-317.test.ts); what 2.51
 * promised its readers still holds there, and is checked there now.
 */
describe("what the 2.51 guide promised, on the /guide page (3.0.17)", () => {
  const home = read("app/(app)/guide/GuideHome.tsx");

  it("still lists workflows under the areas, and says the version and the date it was released", () => {
    expect(home).toMatch(/GUIDE_AREAS\.map\(\(area\) =>/);
    expect(home).toContain("OneBook {versionLabel(GUIDE_VERSION)} · updated {formatDate(latest.date)}");
  });

  it("still says which books are open", () => {
    expect(home).toContain("companyNotice(company)");
    expect(home).toContain("Sample company: ${company?.name}");
    expect(home).toContain("Live books: ${company?.name}");
  });

  it("is given the open company by its own page, not by the shell", () => {
    const page = read("app/(app)/guide/page.tsx");
    expect(page).toContain("resolveActiveCompany()");
    expect(page).toMatch(/company=\{active \?/);
  });
});

describe("the guide's code", () => {
  it("loads on the guide's pages only, not with every page", () => {
    // 2.51 got there by loading the drawer on the first press of Guide; a page
    // of its own gets there by being a page.
    for (const file of ["components/AppShell.tsx", "components/assistant/AssistantLauncher.tsx", "components/PageHeader.tsx"]) {
      expect(read(file), file).not.toMatch(/from "@\/lib\/domain\/(system-guide|guide-help|screen-context)"/);
    }
  });
});

describe("the help buttons while a panel is open", () => {
  it("step out of sight but keep their room", () => {
    const launcher = read("components/assistant/AssistantLauncher.tsx");
    expect(launcher).toContain('askOpen ? " assistant-launcher--behind-panel" : ""');
    const css = read("app/globals.css");
    expect(css).toMatch(/\.assistant-launcher--behind-panel \{\s*visibility: hidden;\s*pointer-events: none;\s*\}/);
  });
});

describe("the 2.51 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.51")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed and dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(compareVersions(APP_VERSION, "2.51")).toBeGreaterThanOrEqual(0);
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
