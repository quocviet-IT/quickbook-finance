import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app shell is on every signed-in page, so everything it imports statically
 * is JavaScript every page downloads before anyone can use it. The help drawers,
 * the release notes and the Supabase browser client are opened by a click — the
 * page does not need them to draw — and together they were most of the shell's
 * own weight (the changelog alone is over 120 KB of source). They are loaded on
 * demand; this test keeps them that way by following the shell's static imports
 * and naming the chain that reaches one of them.
 */
const ROOT = process.cwd();
const SHELL = join(ROOT, "components", "AppShell.tsx");

const ON_DEMAND = [
  "components/ai/AskAiPanel.tsx",
  "components/feedback/ReportDialog.tsx",
  "components/guide/SystemGuideDrawer.tsx",
  "lib/domain/changelog.ts",
  "lib/domain/system-guide.ts",
  "lib/domain/screen-context.ts",
  "lib/db/client.ts",
];

// `import … from "x"`, `export … from "x"` and `import "x"`. `import type` is
// erased at build time, and `import("x")` is the on-demand form this test exists
// to allow, so neither counts.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function resolveModule(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else return null; // a package: measured by the bundle report, not here
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file the entry reaches statically, mapped to the file that imported it. */
function staticGraph(entry: string): Map<string, string | null> {
  const importedBy = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const match of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const target = resolveModule(file, match[1] ?? match[2]);
      if (target && !importedBy.has(target)) {
        importedBy.set(target, file);
        queue.push(target);
      }
    }
  }
  return importedBy;
}

function chainTo(graph: Map<string, string | null>, file: string): string {
  const steps: string[] = [];
  for (let at: string | null | undefined = file; at; at = graph.get(at)) {
    steps.unshift(relative(ROOT, at).replaceAll("\\", "/"));
  }
  return steps.join(" → ");
}

const graph = staticGraph(SHELL);

describe("the app shell's static imports", () => {
  it("are followed through the launcher and its helpers", () => {
    // Without this, a walker that found nothing would pass every check below.
    expect(graph.has(join(ROOT, "components", "assistant", "AssistantLauncher.tsx"))).toBe(true);
    expect(graph.has(join(ROOT, "lib", "client", "release-notes.ts"))).toBe(true);
  });

  it.each(ON_DEMAND)("leave %s to be loaded when it is opened", (module) => {
    const target = join(ROOT, module);
    // A renamed file would otherwise make this pass by being absent.
    expect(existsSync(target)).toBe(true);
    expect(graph.has(target) ? chainTo(graph, target) : null).toBeNull();
  });
});
