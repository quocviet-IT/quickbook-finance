import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every client component the signed-in layout imports is JavaScript every page
 * downloads — Next lists them for each route below the layout whether or not
 * this request renders them, which is how the no-company notice shipped the
 * Supabase browser client to every page. The shell needs that client for one
 * thing, signing out, so it is fetched on that click; this test follows the
 * layout's client imports and names the chain if it ever comes back.
 *
 * Why only this: the help panels were tried the same way and taken back. They
 * share Ant Design's Modal, Drawer and Form with most pages, so moving them out
 * of the shell split that shared code into a copy per page — each first visit
 * got smaller, the app as a whole grew by about 330 KB, and the bundle budget
 * (tests/quality/budgets.json) refused it, rightly. The Supabase client is a
 * package of its own, used by nothing else here, so it leaves cleanly.
 */
const ROOT = process.cwd();
const LAYOUT = join(ROOT, "app", "(app)", "layout.tsx");
const BROWSER_CLIENT = join(ROOT, "lib", "db", "client.ts");

// `import … from "x"`, `export … from "x"` and `import "x"`. `import type` is
// erased at build time, and `import("x")` is the on-demand form this test exists
// to allow, so neither counts.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function specifiers(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2]);
}

function resolveModule(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else return null; // a package: checked by name below, measured by the bundle report
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

function isClientComponent(file: string): boolean {
  return /^\s*["']use client["']/.test(readFileSync(file, "utf8"));
}

// A client file that imports a Server Action gets a reference to call, not the
// action's code, so nothing behind a "use server" module reaches the browser.
function isServerActionModule(file: string): boolean {
  return /^\s*["']use server["']/.test(readFileSync(file, "utf8"));
}

/** Every file the entries reach statically, mapped to the file that imported it. */
function staticGraph(entries: string[]): Map<string, string | null> {
  const importedBy = new Map<string, string | null>(entries.map((entry) => [entry, null]));
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (isServerActionModule(file)) continue;
    for (const specifier of specifiers(file)) {
      const target = resolveModule(file, specifier);
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

const layoutClients = specifiers(LAYOUT)
  .map((specifier) => resolveModule(LAYOUT, specifier))
  .filter((file): file is string => file !== null && isClientComponent(file));
const graph = staticGraph(layoutClients);

describe("the signed-in layout's client imports", () => {
  it("are found and followed", () => {
    // Without this, a walker that found nothing would pass every check below.
    expect(layoutClients.map((file) => relative(ROOT, file).replaceAll("\\", "/")).sort()).toEqual(
      ["components/AppShell.tsx", "components/NoCompanyNotice.tsx"],
    );
    expect(graph.has(join(ROOT, "components", "assistant", "AssistantLauncher.tsx"))).toBe(true);
  });

  it("leave the Supabase browser client to the sign-out click", () => {
    expect(existsSync(BROWSER_CLIENT)).toBe(true);
    expect(graph.has(BROWSER_CLIENT) ? chainTo(graph, BROWSER_CLIENT) : null).toBeNull();
  });

  it("import no Supabase package directly", () => {
    const direct = [...graph.keys()]
      .filter((file) => specifiers(file).some((specifier) => specifier.startsWith("@supabase/")))
      .map((file) => chainTo(graph, file));
    expect(direct).toEqual([]);
  });
});
