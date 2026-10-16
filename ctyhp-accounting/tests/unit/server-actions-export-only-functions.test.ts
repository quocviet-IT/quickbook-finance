import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A "use server" file may export async functions and nothing else.
 *
 * Five work-surface action files re-exported two types (`export type { … }`).
 * The production build turned that into a reference to names that do not exist
 * at runtime, so loading the module threw "WorkItemActionResult is not defined"
 * and every Dismiss, Assign and due date on the overview pages failed with a
 * server error. A type is imported from where it is defined, never re-exported
 * from a server action file.
 */
function serverActionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) serverActionFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const text = readFileSync(join(process.cwd(), path), "utf8");
      if (/^\s*["']use server["'];?/.test(text)) out.push(path);
    }
  }
  return out;
}

describe('"use server" files', () => {
  const files = [...serverActionFiles("app"), ...serverActionFiles("lib")];

  it("are found", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("re-export no types or values from elsewhere", () => {
    const offenders = files.filter((f) => /^\s*export\s+(type\s+)?\{[^}]*\}\s*(from\s+["'][^"']+["'])?\s*;?\s*$/m.test(readFileSync(join(process.cwd(), f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
