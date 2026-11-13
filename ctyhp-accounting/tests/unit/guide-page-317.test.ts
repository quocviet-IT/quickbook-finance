import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { guideCardMeta, stepScreen } from "@/lib/domain/guide-help";

/**
 * 3.0.17: the guide leaves the floating help buttons — a drawer people tucked
 * away and then could not find — and becomes a page in the left menu, with a
 * Help link on every screen. The words are the same; where they live changed.
 */
const ROOT = process.cwd();
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");

describe("the guide is a page of its own (3.0.17)", () => {
  it("lists the guides at /guide and gives each workflow a page", () => {
    expect(existsSync(join(ROOT, "app", "(app)", "guide", "page.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "app", "(app)", "guide", "[id]", "page.tsx"))).toBe(true);
  });

  it("opens straight on the one guide that covers the screen a Help link came from", () => {
    const page = read("app", "(app)", "guide", "page.tsx");
    expect(page).toMatch(/guideLanding\(/);
    expect(page).toMatch(/redirect\(/);
  });

  it("no longer exists as a drawer", () => {
    expect(existsSync(join(ROOT, "components", "guide", "SystemGuideDrawer.tsx"))).toBe(false);
  });
});

describe("where the guide is reached from (3.0.17)", () => {
  const shell = read("components", "AppShell.tsx");
  const launcher = read("components", "assistant", "AssistantLauncher.tsx");

  it("sits at the foot of the left menu, above Settings", () => {
    expect(shell).toMatch(/HELP_NAV_ITEM/);
    expect(shell).toMatch(/\[HELP_NAV_ITEM, \.\.\.visibleNavigation\.filter\(\(item\) => item\.key === "\/settings"\)\]/);
  });

  it("stays selected on every guide page", () => {
    expect(shell).toMatch(/findActivePage\(pathname, \[\.\.\.NAV, HELP_NAV_ITEM\]\)/);
  });

  it("says New there while a release is unread — a word, never a count of every release", () => {
    // A browser that has never opened the notes reads all 211 releases as unread.
    expect(shell).toMatch(/releasesSince\(/);
    expect(shell).toMatch(/>\s*New\s*</);
  });

  it("is gone from the floating help buttons, which keep Report and Ask Abacus (Ask AI until 3.0.20)", () => {
    expect(launcher).not.toMatch(/System guide|SystemGuideDrawer|openGuide/);
    expect(launcher).toMatch(/Report/);
    expect(launcher).toMatch(/Ask Abacus/);
  });
});

describe("the Help link on every screen (3.0.17)", () => {
  const header = read("components", "PageHeader.tsx");
  const helpLink = read("lib", "domain", "help-link.ts");

  it("is part of every page's header", () => {
    expect(header).toMatch(/helpHref\(/);
    expect(header).toMatch(/Help/);
  });

  it("carries no guide data to the pages it sits on", () => {
    // The workflows are some 1,600 lines; every page would download them.
    expect(header).toMatch(/from "@\/lib\/domain\/help-link"/);
    expect(helpLink).not.toMatch(/system-guide|screen-context|screen-names|changelog/);
  });
});

describe("what the guide pages say (3.0.17)", () => {
  const home = read("app", "(app)", "guide", "GuideHome.tsx");
  const flowView = read("app", "(app)", "guide", "[id]", "GuideFlowView.tsx");
  const whatsNew = read("components", "guide", "WhatsNewPanel.tsx");

  it("opens on the guides, not on the release notes", () => {
    expect(home).toMatch(/initialTab \?\? "guides"|useState<GuideTab>\(initialTab\)/);
  });

  it("counts the release notes read when they are opened, and only then", () => {
    expect(home).toMatch(/if \(tab === "new"\) markReleasesSeen\(\)/);
  });

  it("keeps the New marks on the releases being read, from what was read when the page opened", () => {
    // Opening the tab marks them read at once; marks taken from the live value
    // would vanish from the very notes the reader just opened.
    expect(home).toMatch(/useState\(\(\) => lastReleaseSeen\(\)\)/);
    expect(home).toMatch(/unread=\{unreadAtOpen\.has\(release\.version\)\}/);
  });

  it("names screens, never paths", () => {
    for (const source of [home, flowView, whatsNew]) {
      // A route as text, that is — `href={step.route}` is a link doing its job.
      expect(source).not.toMatch(/(?<!=)\{\s*(flow|step|change|screen)\.route\s*\}/);
    }
    expect(flowView).toMatch(/screenName\(|stepScreen\(/);
    expect(whatsNew).toMatch(/screenName\(/);
  });

  it("describes every workflow card in words, with no path in them", () => {
    for (const flow of GUIDE_FLOWS) {
      const meta = guideCardMeta(flow);
      expect(meta.join(" "), flow.id).not.toMatch(/\//);
      expect(meta[0]).toMatch(/^\d+ steps?$/);
    }
    // Since 3.0.28 a guide with a video says so, and how long it runs.
    expect(guideCardMeta(GUIDE_FLOWS.find((flow) => flow.id === "get-paid")!)).toEqual(["7 steps", "Starts on Invoices", "Video · 1:16"]);
    expect(guideCardMeta(GUIDE_FLOWS.find((flow) => flow.id === "record-a-paid-sale")!)).toEqual(["5 steps", "Starts on Sales Receipts"]);
  });

  it("says where each step happens", () => {
    const flow = GUIDE_FLOWS.find((f) => f.id === "get-paid")!;
    expect(stepScreen(flow, flow.steps[0])).toBe("Invoices");
    expect(stepScreen(flow, flow.steps[3])).toBe("Payments");
  });

  it("writes no label in capitals", () => {
    const css = read("app", "globals.css");
    const start = css.indexOf("/* The guide (3.0.17)");
    const end = css.indexOf("/* End of the guide (3.0.17) */");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(css.slice(start, end)).not.toMatch(/text-transform:\s*uppercase/);
  });
});
