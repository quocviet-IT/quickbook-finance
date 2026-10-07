import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...path: string[]) => readFileSync(join(process.cwd(), "app", "(app)", "banking", ...path), "utf8");
/** The body of `async function name(` up to the next function at the same depth. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = source.indexOf("\n  async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

/**
 * What the statement screens say and do around the server (1.85): a dialog
 * never keeps spinning when the server cannot be reached, a kept file that
 * could not be tied is said, and completing a month says what was matched.
 */
describe("the statement screens", () => {
  const workspace = read("reconcile", "[id]", "ReconcileWorkspaceClient.tsx");
  const banking = read("BankingClient.tsx");
  const fromFiles = read("reconcile", "from-files", "FromFilesClient.tsx");

  it("leave the busy state of Import and Attach whatever the server does", () => {
    for (const [name, reset] of [
      ["importStatement", "setImporting(false)"],
      ["attachStatement", "setAttaching(false)"],
    ] as const) {
      const body = handler(workspace, name);
      expect(body, name).toMatch(new RegExp(`finally \\{\\s*${reset.replace(/[()]/g, "\\$&")};`));
      expect(body.split(reset).length - 1, name).toBe(1);
      expect(body, name).toContain("serverFailure(error)");
    }
    const importing = handler(banking, "confirmImport");
    expect(importing).toMatch(/finally \{\s*setBusy\(null\);/);
    expect(importing).toContain("serverFailure(error)");
  });

  it("say when a kept file could not be tied to its import or reconciliation", () => {
    expect(handler(workspace, "importStatement")).toContain("res.data.fileWarning");
    expect(handler(banking, "confirmImport")).toContain("result.data.fileWarning");
    expect(fromFiles.match(/res\.data\??\.fileWarning\) message\.warning/g)?.length).toBe(3);
  });

  it("offer Attach the statement only once the reconciliation's figures are loaded", () => {
    expect(workspace).toMatch(/disabled=\{!detail\} onClick=\{\(\) => setAttachOpen\(true\)\}/);
  });

  it("say what Complete and a run of months matched in Bank Transactions", () => {
    expect(workspace).toContain("completedMessage(r.data?.matched ?? null, r.data?.matchError ?? null)");
    expect(fromFiles).toContain("bankLinesMatchedSentence(done.matched)");
    expect(fromFiles).toContain("bankLinesNotMatchedSentence(res.data.matchError");
  });
});
