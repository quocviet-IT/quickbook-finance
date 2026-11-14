import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.31: 3.0.30 underlined links inside sentences, and named `li` and
 * `.ant-typography` among the containers that hold sentences. Every item of
 * the side menu is an `li`, and a report card's title is a Typography title,
 * so the whole menu and every card on the Report Center came out underlined.
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

function underlinedContainers(): string[] {
  const match = css.match(/:is\(([^)]*)\) a:not\(\.ant-btn\) \{\n  text-decoration: underline;/);
  expect(match, "the in-text link rule").not.toBeNull();
  return match![1].split(",").map((part) => part.trim());
}

describe("which links are underlined (3.0.31)", () => {
  it("only those inside running text: a paragraph, an alert, an empty state, a table's second line, marked prose", () => {
    expect(underlinedContainers()).toEqual([
      "p",
      ".ant-alert-title",
      ".ant-alert-description",
      ".ant-empty-description",
      ".accounting-secondary-line",
      ".accounting-prose",
    ]);
  });

  it("never a list item, a description list or a Typography element, which reach the menu and card titles", () => {
    const containers = underlinedContainers();
    for (const tooWide of ["li", "dd", "ul", "ol", ".ant-typography", ".ant-menu", ".ant-menu-item", "nav", "h1", "h2", "h3", "h4", "h5"]) {
      expect(containers, tooWide).not.toContain(tooWide);
    }
  });

  it("is the only rule that underlines a link", () => {
    // Comments read like sentences ("a link…"), so they go before selectors are read.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = bare.match(/[^{}]*\{[^{}]*text-decoration(-line)?:\s*underline[^{}]*\}/g) ?? [];
    const onLinks = rules.filter((rule) => /(^|[\s,>(])a([\s:.,[)]|$)/.test(rule.split("{")[0].trim()));
    expect(onLinks.map((rule) => rule.split("{")[0].trim().slice(0, 120))).toEqual([
      expect.stringContaining(":is(p, "),
    ]);
  });
});

describe("the release note (3.0.31)", () => {
  it("says the menu and the report cards are no longer underlined", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.31");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/menu/);
    expect(said).toMatch(/Report Center/);
  });
});
