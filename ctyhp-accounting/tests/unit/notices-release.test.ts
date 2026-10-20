import { readFileSync } from "node:fs";
import { join } from "node:path";
import { theme } from "antd";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { antdThemeTokens, resolveToken } from "@/lib/design/tokens";

describe("the notices release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Pale notices in light mode"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("says the notices are pale, dark mode is unchanged, and the long ones are shorter", () => {
    for (const words of ["pale teal or pale green", "Dark mode is unchanged", "Shorter notices", "five lines to two"]) {
      expect(said).toContain(words);
    }
  });
});

/** Relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("an info or success notice's background in light mode", () => {
  // Ant Design derives these from the intent colour when they are not set, and
  // for this teal and this green it derived #a8b5b2 and #b4bfb6: a heavy
  // grey-green box (UI review, 2026-10-20). The wash has to stay near white.
  const light = theme.getDesignToken({ algorithm: theme.defaultAlgorithm, token: antdThemeTokens("light").token });

  it("is the token's pale wash, not a colour Ant Design derived", () => {
    expect(light.colorInfoBg).toBe(resolveToken("feedback.noticeBg", "light"));
    expect(light.colorSuccessBg).toBe(resolveToken("feedback.successBg", "light"));
  });

  it("is nearly as light as the card it sits on", () => {
    for (const wash of [light.colorInfoBg, light.colorSuccessBg]) {
      expect(luminance(wash)).toBeGreaterThan(0.85);
    }
  });

  it("keeps dark's deep tints", () => {
    const dark = theme.getDesignToken({ algorithm: theme.darkAlgorithm, token: antdThemeTokens("dark").token });
    for (const wash of [dark.colorInfoBg, dark.colorSuccessBg]) {
      expect(luminance(wash)).toBeLessThan(0.05);
    }
  });
});

describe("the notices that were cut", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("no longer show an internal rule key on the Accounting overview", () => {
    const list = read("components/accounting-dashboard/AccountingInsightList.tsx");
    expect(list).not.toContain("<code>{rule.ruleKey}</code>");
    expect(list).toContain("rule.waitingOn");
  });

  it("keep each one's description to about two lines", () => {
    // A description longer than this ran three to five lines at 1280px.
    const descriptions: [string, RegExp][] = [
      ["app/(app)/settings/backups/BackupsClient.tsx", /message="What a snapshot holds"[\s\S]*?description="([^"]*)"/],
      ["app/(app)/settings/users/UsersClient.tsx", /message="Privileged access policy"[\s\S]*?description="([^"]*)"/],
      ["app/(app)/settings/approvals/ApprovalPoliciesClient.tsx", /message="How a policy behaves once enabled"[\s\S]*?description="([^"]*)"/],
      ["app/(app)/settings/purchasing/PurchasingConfigClient.tsx", /message="How three-way matching uses these"[\s\S]*?description="([^"]*)"/],
      ["app/(app)/reports/1099/Report1099Client.tsx", /message="Review data, not a filing"[\s\S]*?description="([^"]*)"/],
    ];
    for (const [path, pattern] of descriptions) {
      const description = read(path).match(pattern)?.[1];
      expect(description, path).toBeDefined();
      expect(description!.length, path).toBeLessThanOrEqual(230);
    }
  });
});
