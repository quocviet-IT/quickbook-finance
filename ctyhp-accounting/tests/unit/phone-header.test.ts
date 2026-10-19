import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * On a phone the header holds its controls on one row and the search field on
 * the next. Before, an inline 230px company list shared 374px with six other
 * controls and was drawn over the search field, New transaction, the theme
 * switch and Approvals.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("app/globals.css");
const phoneBlock = css.slice(css.indexOf(".app-shell__company-select {"));

describe("the header on a phone", () => {
  it("gives the company list no fixed width in the component", () => {
    const switcher = read("components/CompanySwitcher.tsx");
    expect(switcher).not.toMatch(/minWidth:\s*230/);
    expect(switcher).toContain('className="app-shell__company-select"');
  });

  it("keeps 230px on a wide screen and lets it shrink on a phone", () => {
    expect(css).toMatch(/\.app-shell__company-select \{\s*min-width: 230px;\s*\}/);
    expect(phoneBlock).toMatch(/@media \(max-width: 575px\)/);
    expect(phoneBlock).toMatch(/\.app-shell__company-select \{\s*width: 100%;\s*min-width: 0;/);
  });

  it("shows the company's name alone in the closed list, not a Sample tag cut to a sliver", () => {
    expect(phoneBlock).toMatch(/\.app-shell__company-select \.ant-tag,[\s\S]*?\.app-shell__company-select \.ant-select-prefix \{\s*display: none;/);
    expect(phoneBlock).toMatch(/\.app-shell__company-select \.ant-space-item \{\s*overflow: hidden;\s*text-overflow: ellipsis;/);
  });

  it("wraps onto two rows, with the search field across the second", () => {
    expect(phoneBlock).toMatch(/\.app-shell__header\.ant-layout-header \{\s*flex-wrap: wrap;\s*height: auto;/);
    expect(phoneBlock).toMatch(/\.app-shell__header-search \{\s*order: 10;\s*flex: 1 1 100%;/);
  });
});
