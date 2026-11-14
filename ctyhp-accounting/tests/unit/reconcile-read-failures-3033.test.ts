import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAILURE_TITLE } from "@/app/(app)/banking/reconcile/[id]/ReadFailure";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.33 (UI audit S2): on the reconciliation screen a read that failed said
 * "Failed" in a toast gone in seconds, and left its part of the screen looking
 * empty — which reads as the books having nothing there. Each part now says,
 * where it sits, that it could not be read and why, keeps what it had, and
 * offers Retry.
 */
const DIR = join(process.cwd(), "app", "(app)", "banking", "reconcile", "[id]");
const read = (name: string) => readFileSync(join(DIR, name), "utf8").replace(/\r\n/g, "\n");
const workspace = read("ReconcileWorkspaceClient.tsx");
const notice = read("ReadFailure.tsx");

describe("a read that fails on the reconciliation screen (3.0.33)", () => {
  it("is no longer a toast that says Failed", () => {
    for (const toast of ["message.error(l.error", "message.error(d.error", "message.error(s.error", "message.error(h.error", "Could not work out what to add"]) {
      expect(workspace, toast).not.toContain(toast);
    }
  });

  it("names the part it is about, for all five things the screen reads", () => {
    expect(Object.keys(FAILURE_TITLE).sort()).toEqual(["figures", "history", "lines", "plan", "statement"]);
    for (const part of Object.keys(FAILURE_TITLE)) {
      expect(workspace, part).toMatch(new RegExp(`<ReadFailure part="${part}" reason=\\{failed\\.${part}\\}`));
    }
  });

  it("is an alert, with the server's reason and a Retry", () => {
    expect(notice).toMatch(/role="alert"/);
    expect(notice).toMatch(/description=\{`\$\{reason\} /);
    expect(notice).toMatch(/>\s*Retry\s*</);
  });

  it("keeps what was read before, and says it may be out of date", () => {
    // Each part is replaced only on a read that worked.
    expect(workspace).toMatch(/if \(l\.ok && l\.data\) setLines\(l\.data\);\n\s+else next\.lines = /);
    expect(workspace).toMatch(/if \(d\.ok && d\.data\) setDetail\(d\.data\);\n\s+else next\.figures = /);
    expect(workspace).toMatch(/if \(s\.ok && s\.data\) setStatement\(s\.data\);\n\s+else next\.statement = /);
    expect(notice).toMatch(/may be out of date/);
  });

  it("does not show an empty statement or an empty account in place of one that was not read", () => {
    expect(workspace).toMatch(/failed\.statement && !statement\s*\? "Not read\."/);
    expect(workspace).toMatch(/emptyText: failed\.statement \? "The statement lines could not be read"/);
    expect(workspace).toMatch(/emptyTitle=\{failed\.lines \? "The book lines could not be read"/);
  });

  it("treats a request that never arrived like a refusal", () => {
    expect(workspace.match(/The request did not reach the server/g)?.length).toBe(3);
  });

  it("waits, rather than showing empty tables, while the first read is on its way", () => {
    expect(workspace).toMatch(/useState\(\(\) => seed === null\)/);
  });
});

describe("the release note (3.0.33)", () => {
  it("says the reconciliation screen tells which part could not be read", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.33");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/could not be read/);
    expect(said).toMatch(/Retry/);
  });
});
