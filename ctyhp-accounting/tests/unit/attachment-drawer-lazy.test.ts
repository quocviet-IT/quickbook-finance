import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The attachment drawer is fetched when a paperclip is clicked, not when the
 * screen opens.
 *
 * It carries the uploader, the scan status and the document list, and it was
 * mounted — closed — on eight screens. Measured on /banking: 121 KB of the
 * first load, on the heaviest page in the app, for a drawer most readers never
 * open.
 *
 * Safe because the component already does nothing until it has a target: every
 * effect returns early on a null one (AttachmentDrawer.tsx) and the Drawer is
 * `destroyOnHidden`. Not rendering it while closed is what it was already
 * doing, minus the download.
 */
function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (entry.endsWith(".tsx")) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("the attachment drawer", () => {
  const root = process.cwd();
  const users = sourceFiles(join(root, "app"), root).filter((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return source.includes("<AttachmentDrawer");
  });

  it("is used by the screens this test is meant to be guarding", () => {
    expect(users.length).toBeGreaterThanOrEqual(7);
  });

  it("is loaded on demand everywhere it is used", () => {
    const eager: string[] = [];
    for (const file of users) {
      const source = readFileSync(join(root, file), "utf8");
      // A value import of the component pulls it into the first load; the type
      // import is erased and is fine.
      if (/^import AttachmentDrawer/m.test(source)) eager.push(file);
      if (!/dynamic\(\(\) => import\("@\/components\/documents\/AttachmentDrawer"\)/.test(source)) {
        eager.push(file);
      }
    }
    expect([...new Set(eager)]).toEqual([]);
  });

  it("is rendered only once something has been chosen to attach to", () => {
    const alwaysMounted: string[] = [];
    for (const file of users) {
      const source = readFileSync(join(root, file), "utf8");
      const at = source.indexOf("<AttachmentDrawer");
      // The guard sits on the line or two above the element.
      const before = source.slice(Math.max(0, at - 220), at);
      if (!/attachmentTarget \?/.test(before)) alwaysMounted.push(file);
    }
    expect(alwaysMounted).toEqual([]);
  });
});
