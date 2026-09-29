import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";

/**
 * A page asked by its link to open a form (`?new=1`) must send that form closed
 * and open it once hydration is over. A dialog lives in a portal the server
 * cannot draw; opened in the first client render, it is markup the server
 * never sent, and React throws the page away and draws it again (error 418).
 */
function Probe({ initial }: { initial: boolean }) {
  const [open] = useInitiallyOpen(initial);
  return createElement("output", null, open ? "open" : "closed");
}

describe("useInitiallyOpen", () => {
  it("renders a form the link asked for as closed on the server, which is what hydration compares against", () => {
    expect(renderToString(createElement(Probe, { initial: true }))).toContain("closed");
    expect(renderToString(createElement(Probe, { initial: false }))).toContain("closed");
  });
});

const ROOT = process.cwd();
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("screens opened by a link", () => {
  it("never open a form in their first render from a server flag", () => {
    const offenders = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))]
      .filter((file) => /useState\(\s*initial\w*Open\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });
});
