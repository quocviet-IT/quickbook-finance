import { jsPDF } from "jspdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { readPdfStatements, statementProof, type PdfGlyph } from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, type PdfScenario } from "../fixtures/pdf-statements";

/** The scenario printed as a real PDF: every cell where its glyph sits, on a letter page. */
function pdfOf(scenario: PdfScenario): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(9);
  scenario.pages.forEach((rows, p) => {
    if (p) doc.addPage();
    for (const [y, ...cells] of rows) for (const [x, text] of cells) doc.text(text, x, 792 - y);
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

async function open(data: Uint8Array): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const task = getDocument({ data, verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}

describe("a PDF statement read end to end through pdf.js", () => {
  it.each(PDF_SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const read = await open(pdfOf(scenario));
      if (!("glyphs" in read)) throw new Error(`could not open: ${read.failure}`);
      const statements = readPdfStatements(read.glyphs);
      expect(statements.map((s) => s.lines.length)).toEqual(scenario.expected.map((e) => e.lines.length));
      for (const s of statements) expect(statementProof(s).differenceMinor).toBe(0);
    },
    20_000,
  );

  it("finds no text in a PDF that is only a picture", async () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.rect(40, 40, 200, 100, "F");
    expect(await open(new Uint8Array(doc.output("arraybuffer")))).toEqual({ glyphs: [] });
  }, 20_000);

  it("says a locked PDF wants a password", async () => {
    const doc = new jsPDF({
      unit: "pt",
      format: "letter",
      encryption: { userPassword: "example", ownerPassword: "example", userPermissions: ["print"] },
    });
    doc.text("Example Bank", 40, 40);
    expect(await open(new Uint8Array(doc.output("arraybuffer")))).toEqual({ failure: "password" });
  }, 20_000);

  it("says a file that is not a PDF cannot be read", async () => {
    expect(await open(new Uint8Array([1, 2, 3, 4]))).toEqual({ failure: "unreadable" });
  }, 20_000);
});

describe("pdfFailure", () => {
  it("tells a password from anything else", () => {
    expect(pdfFailure({ name: "PasswordException" })).toBe("password");
    expect(pdfFailure(new Error("broken"))).toBe("unreadable");
    expect(pdfFailure("broken")).toBe("unreadable");
  });
});
