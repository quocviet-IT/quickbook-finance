import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

describe("a row with an action button (3.0.16)", () => {
  it("lets a 32px button reach 4px into the cell's padding, so the row is 41px, not 49px", () => {
    const rule = css.match(
      /\.ant-table-tbody > tr > \.ant-table-cell \.accounting-icon-action-wrap,\n\.ant-table-tbody > tr > \.ant-table-cell \.ant-btn:not\(\.ant-btn-sm\):not\(\.ant-btn-lg\):not\(\.accounting-icon-action\) \{([^}]*)\}/,
    );
    expect(rule, "the table action rule").not.toBeNull();
    expect(rule![1]).toMatch(/margin-block:\s*-4px;/);
  });

  it("keeps the 32px target a finger needs", () => {
    const button = css.match(/\.accounting-icon-action\.ant-btn \{([^}]*)\}/);
    expect(button![1]).toMatch(/min-width:\s*32px;/);
    expect(button![1]).toMatch(/min-height:\s*32px;/);
  });
});
