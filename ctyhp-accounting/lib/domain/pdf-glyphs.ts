/**
 * The text of a PDF as glyphs, for the statement reader (pdf-statement.ts).
 *
 * It takes the document pdf.js has already opened — in the browser
 * (lib/client/pdf-text.ts) or in Node for the tests — so it holds no pdf.js
 * import of its own.
 */
import type { PdfGlyph } from "./pdf-statement";

/** The part of pdf.js's PDFDocumentProxy this needs. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>;
}

/** Every piece of text on every page, with where it sits on the page; blank pieces are left out. */
export async function glyphsFromDocument(doc: PdfDocumentLike): Promise<PdfGlyph[]> {
  const glyphs: PdfGlyph[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    for (const item of content.items) {
      const { str, transform } = item as { str?: unknown; transform?: unknown };
      const text = typeof str === "string" ? str.trim() : "";
      if (!text || !Array.isArray(transform)) continue;
      glyphs.push({ page, x: Number(transform[4]), y: Number(transform[5]), text });
    }
  }
  return glyphs;
}

export type PdfReadFailure = "password" | "unreadable";

/** Why pdf.js could not open a file: it wants a password, or it cannot read the file at all. */
export function pdfFailure(error: unknown): PdfReadFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "PasswordException" ? "password" : "unreadable";
}
