import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3.0.45, audit item L8. The tables that ask for a sticky header (Invoices,
 * Customers, Payments, Fixed assets, Banking...) had one that scrolled away
 * with the page. Measured on production before the fix: on /banking, scrolling
 * 600px moved the header from 457px to -143px.
 *
 * There were two causes. The table frame was `overflow: hidden`, which makes a
 * scroll container that never scrolls, and a sticky header follows its nearest
 * scroll container. Ant Design also pins the header at `top: 0`, behind the
 * app's own sticky header.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("a sticky table header follows the page", () => {
  const css = read("app", "globals.css");

  it("clips the table frame's corners without making it a scroll container", () => {
    const frame = rule(css, ".accounting-data-table");
    expect(frame).toContain("overflow: clip;");
    expect(frame).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll)/);
  });

  it("stops the header under the app header and the filter bar, whatever their heights", () => {
    const holder = rule(css, ".accounting-data-table .ant-table-sticky-holder");
    expect(holder).toContain("top: calc(var(--app-header-height, 56px) + var(--filter-bar-space, 0px)) !important;");
    // The filter bar was pinned at 64px, under a header that is 109px on a phone.
    expect(css).toContain(
      ".accounting-filter-bar {\n  position: sticky;\n  top: calc(var(--app-header-height, 56px) + 8px);\n  z-index: 10;\n}",
    );
    expect(css).not.toMatch(/\.accounting-filter-bar \{\n {2}position: sticky;\n {2}top: 64px;/);
  });

  it("does not pin the filter bar on a phone, where the header alone takes two rows", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 767px) {\n  .accounting-filter-bar {"));
    expect(phone).toMatch(/^@media \(max-width: 767px\) \{\n {2}\.accounting-filter-bar \{\n {4}position: static;/);
  });

  it("has the filter bar write the room it takes, and clear it when it goes", () => {
    const bar = read("components", "ui", "FilterBar.tsx");
    expect(bar).toContain('root.style.setProperty("--filter-bar-space", written)');
    expect(bar).toContain("+ 8}px`");
    expect(bar).toContain('root.style.removeProperty("--filter-bar-space")');
    expect(bar.match(/ref=\{ref\}/g)).toHaveLength(2);
  });

  it("measures the app header into --app-header-height as the window changes", () => {
    const shell = read("components", "AppShell.tsx");
    expect(shell).toContain("useHeaderHeightVariable();");
    expect(shell).toContain('document.querySelector<HTMLElement>(".app-shell__header")');
    expect(shell).toContain("new ResizeObserver(write)");
    expect(shell).toContain('root.style.setProperty("--app-header-height"');
  });
});
