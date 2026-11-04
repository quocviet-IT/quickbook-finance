import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

/** The OCR offer of a scanned file lives in a full-width row, not the narrow Read column (3.0.7). */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const dir = ["app", "(app)", "banking", "reconcile", "from-files"];
const fromFiles = read(...dir, "FromFilesClient.tsx");
const css = read(...dir, "run-table.module.css");

describe("From statement files: a scanned file's offer", () => {
  it("is rendered by expandedRowRender, never inside the Read column's render", () => {
    const start = fromFiles.indexOf("expandedRowRender: (c) =>");
    const end = fromFiles.indexOf("columns={[", start);
    expect(start).toBeGreaterThan(0);
    expect(fromFiles.slice(start, end)).toMatch(/<ScannedPdf/);
    const readCol = fromFiles.slice(fromFiles.indexOf('title: "Read"'), fromFiles.indexOf("<Alert key={stop}"));
    expect(readCol).not.toMatch(/<ScannedPdf/);
  });

  it("opens the row with no extra column, so the measured widths do not shift, and not for a card", () => {
    expect(fromFiles).toMatch(/showExpandColumn: false/);
    expect(fromFiles).toMatch(/expandedRowKeys: card \? \[\]/);
    expect(fromFiles).toMatch(/rowExpandable: \(\) => !card/);
  });

  it("holds the offer to a readable measure that stays on screen on a phone", () => {
    expect(css).toMatch(/\.ocrOffer\s*\{[^}]*position: sticky;[^}]*left: 0;[^}]*max-width: min\(640px/);
  });

  it("is announced in the changelog as 3.0.7", () => {
    const r = RELEASES.find((x) => x.version === "3.0.7");
    expect(r?.changes[0]).toMatchObject({ kind: "fixed", route: "/banking/reconcile/from-files" });
  });
});
