import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components", "documents", "AttachmentDrawer.tsx"),
  "utf8",
);

/** The `<Drawer …>` opening tag only — where the header slots are decided. */
const drawerTag = source.slice(source.indexOf("<Drawer"), source.indexOf("<Alert"));

/**
 * The drawer header, and the record label that used to destroy it.
 *
 * Reported with a screenshot: the heading read "Documents", then a line of
 * bank-wire text, then "&", then "Attachments" — the title broken across
 * three lines with the label printed over the top of it.
 *
 * Measured in a browser before the fix, on a 240-character bank description:
 *
 *   drawer panel                600px
 *   .ant-drawer-extra         1,729px   ← the label
 *   .ant-drawer-header-title      0px   ← the heading, crushed to nothing
 *   header horizontal overflow 1,153px
 *
 * The cause is in Ant Design's own stylesheet, and it is not a bug there:
 *
 *   .ant-drawer-header-title { flex: 1; min-width: 0 }   can shrink to zero
 *   .ant-drawer-extra        { flex: none }              never shrinks
 *
 * `extra` is built for a button or a word. Handed 240 characters it takes
 * every pixel it asks for, and the heading beside it gets whatever is left,
 * which was nothing. This is a contract test rather than a rendering one
 * because the component imports Ant Design, and every other UI contract in
 * this repo is held the same way — see bank-categories-ui-contract.test.ts.
 */
describe("the attachment drawer header", () => {
  it("keeps the record label out of the slot that cannot shrink", () => {
    // The whole bug in one line. `extra` may still hold something small and
    // fixed; what it must never hold again is the caller's free-text label.
    expect(drawerTag).not.toMatch(/extra=\{[^}]*target\.label/);
  });

  it("shows the label with the heading instead, where there is room for it", () => {
    expect(drawerTag).toContain("target.label");
  });

  it("truncates the label rather than letting it set the header's width", () => {
    // A 240-character wire description has no natural end. Without this the
    // header simply grows until it is wider than the drawer again.
    expect(drawerTag).toContain("ellipsis");
  });

  it("keeps the whole label reachable on hover", () => {
    // Truncation is only acceptable while nothing is put out of reach: the
    // label is how a reader knows which record's evidence they are looking at.
    expect(drawerTag).toContain("Tooltip");
  });

  it("lets the heading block shrink, which is what makes the ellipsis work", () => {
    // `.ant-drawer-title` is `flex: 1` with no `min-width` of its own, so it
    // inherits `min-width: auto` and refuses to shrink below its content.
    // Without this the ellipsis never engages and the header overflows
    // exactly as it did before, just from a different element.
    expect(drawerTag).toMatch(/minWidth:\s*0/);
  });
});
