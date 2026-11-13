import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { RELEASES } from "@/lib/domain/changelog";
import { guideCardMeta } from "@/lib/domain/guide-help";

/**
 * 3.0.21: a picture for every step. Each is captured from the sample company by
 * scripts/capture-step-shots.mjs: the step's screen, cropped around its control,
 * with the control ringed in orange. Banking's thirty steps follow in a later release,
 * once the sample company has bank accounts to show.
 */

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const steps = GUIDE_FLOWS.flatMap((flow) =>
  flow.steps.map((step, index) => ({ flow, step, label: `${flow.id} step ${index + 1}` })),
);

/** Steps still without a picture. Only ever goes down: zero since 3.0.27, when Banking's thirty got theirs. */
const WAITING_FOR_BANK_DATA = 0;

describe("a picture for every step (3.0.21)", () => {
  it("gives every step outside Banking a picture", () => {
    const missing = steps.filter(({ flow, step }) => flow.area !== "banking" && !step.screenshot).map(({ label }) => label);
    expect(missing).toEqual([]);
  });

  it("leaves only Banking's steps without one, and no more of them than before", () => {
    const without = steps.filter(({ step }) => !step.screenshot);
    expect(without.length).toBeLessThanOrEqual(WAITING_FOR_BANK_DATA);
    for (const { flow, label } of without) expect(flow.area, label).toBe("banking");
  });

  it("points at a picture that is there, described for a reader who cannot see it", () => {
    for (const { step, label } of steps) {
      if (!step.screenshot) continue;
      expect(existsSync(join(ROOT, "public", step.screenshot.src)), `${label}: ${step.screenshot.src}`).toBe(true);
      expect(step.screenshot.alt.length, label).toBeGreaterThan(15);
    }
  });

  it("gives each step its own picture", () => {
    // The transactions import shows its preview twice on purpose (what will be
    // posted, then what was), so the rule is for the step pictures.
    const srcs = steps.flatMap(({ step }) => (step.screenshot?.src.startsWith("/guide/steps/") ? [step.screenshot.src] : []));
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it("keeps the new pictures small: WebP, under 120 KB each", () => {
    for (const { step, label } of steps) {
      if (!step.screenshot?.src.startsWith("/guide/steps/")) continue;
      expect(step.screenshot.src, label).toMatch(/^\/guide\/steps\/[\w-]+\.webp$/);
      expect(statSync(join(ROOT, "public", step.screenshot.src)).size, label).toBeLessThan(120_000);
    }
  });

  it("captures each step picture from a recipe in the script, and nothing else", () => {
    const script = read("scripts", "capture-step-shots.mjs");
    const recipes = [...script.matchAll(/\bshot: "([\w-]+)"/g)].map((match) => match[1]).sort();
    const pictures = steps
      .flatMap(({ step }) => /^\/guide\/steps\/([\w-]+)\.webp$/.exec(step.screenshot?.src ?? "")?.[1] ?? [])
      .sort();
    expect(recipes).toEqual(pictures);
  });

  it("captures only the sample company, never real books", () => {
    const script = read("scripts", "capture-step-shots.mjs");
    expect(script).toMatch(/\.eq\("slug", "meridian"\)/);
    expect(script).toMatch(/if \(!company\?\.is_sample\) throw new Error\("refusing/);
    // People and other companies on a settings screen are swapped for invented
    // names in the page before it is captured; the database is not touched.
    expect(script).toMatch(/function scrub\(/);
  });

  it("is run with npm run guide:step-shots", () => {
    expect(JSON.parse(read("package.json")).scripts["guide:step-shots"]).toBe(
      "node --env-file=.env.local scripts/capture-step-shots.mjs",
    );
  });
});

describe("the guide's cards (3.0.21)", () => {
  it("no longer mark a guide Pictures, now that nearly every guide has them", () => {
    // The chip told the two import guides apart from sixteen without a picture.
    for (const flow of GUIDE_FLOWS) expect(guideCardMeta(flow), flow.id).not.toContain("Pictures");
  });
});

describe("the guide's page shows the pictures (3.0.21)", () => {
  const view = read("app", "(app)", "guide", "[id]", "GuideFlowView.tsx");

  it("loads a step's picture only as it scrolls into view", () => {
    expect(view).toMatch(/loading="lazy"/);
  });

  it("shows a picture no wider than it was taken, so its words read at their own size", () => {
    const css = read("app", "globals.css");
    expect(css).toMatch(/\.system-guide__shot \.ant-image \{[^}]*max-width: 640px;/);
  });
});

describe("the release note (3.0.21)", () => {
  it("says every step has a picture, and that Banking's come next", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.21");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toContain("picture");
    expect(said).toContain("Banking");
  });
});
