import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readScannedStatement, type ScannedStatementDeps } from "@/lib/client/read-scanned-statement";

const text = readFileSync(join(__dirname, "../fixtures/ocr/made-up-statement-clean.md"), "utf8");
const file = new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" });

function deps(statuses: unknown[]): ScannedStatementDeps {
  return {
    keep: vi.fn(async () => ({ ok: true as const, id: "report-1" })),
    request: vi.fn(async () => ({ ok: true, data: { jobId: "job-1" } })),
    status: vi.fn(async () => ({ ok: true, data: statuses.shift() as never })),
    wait: async () => {},
  };
}

describe("readScannedStatement", () => {
  it("keeps the file, waits, shows the pages, and reads the statement", async () => {
    const seen: string[] = [];
    const d = deps([
      { status: "pending", pages_done: 0, pages_total: null, result: null, error: null },
      { status: "running", pages_done: 0, pages_total: 1, result: null, error: null },
      { status: "done", pages_done: 1, pages_total: 1, result: { engine: "e", pages: [{ page: 1, text }] }, error: null },
    ]);
    const out = await readScannedStatement(file, "Example Bank ****4821", (r) => seen.push(r.phase), d);
    expect(d.keep).toHaveBeenCalledWith(file, "Example Bank ****4821", { from: null, to: null });
    expect(seen).toEqual(["sending", "waiting", "reading"]);
    expect("statements" in out && out.statements[0].lines).toHaveLength(14);
  });

  it("says why when the server could not read the file", async () => {
    const out = await readScannedStatement(file, "x", () => {}, deps([
      { status: "failed", pages_done: 0, pages_total: null, result: null, error: "The file has 25 pages; OCR reads at most 20." },
    ]));
    expect(out).toEqual({ message: "The file has 25 pages; OCR reads at most 20." });
  });

  it("says so when the file cannot be kept", async () => {
    const d = deps([]);
    d.keep = vi.fn(async () => ({ ok: false as const, reason: "the store is full" }));
    expect(await readScannedStatement(file, "x", () => {}, d)).toEqual({
      message: "The file could not be sent for reading: the store is full.",
    });
  });
});
