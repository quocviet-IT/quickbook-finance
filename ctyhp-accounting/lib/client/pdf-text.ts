/**
 * A PDF's text, read in the browser, for Import statement.
 *
 * pdf.js comes from OneBook's own bundle the first time a PDF is chosen — not
 * from a CDN at run time, as the prototype fetched version 3.11.174. Its worker
 * is pdf.js's own self-contained module, which the build copies next to the app
 * and pdf.js starts itself. Version 6 compiles no script out of a PDF: the font
 * path behind CVE-2024-4367, which 3.11.174 carries, is gone. The file never
 * leaves the browser; only the lines read are sent.
 */
import type { PdfGlyph } from "@/lib/domain/pdf-statement";
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";

export async function readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}
