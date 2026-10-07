/**
 * A kept PDF drawn as pictures of its pages (1.83), by the same pdf.js that
 * reads statements. Nothing in the file is opened by the browser or run: each
 * page is painted onto a canvas and shown as an image, so a file that was never
 * virus-scanned is looked at, not opened.
 */
import { pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { loadPdfjs } from "@/lib/client/pdf-text";

/** The most pages drawn; a statement is a few pages, and Download has the rest. */
export const PDF_PAGE_LIMIT = 40;

export interface PdfPageImages {
  /** PNG data URLs, one per page drawn, in order. */
  images: string[];
  pageCount: number;
}

export async function pdfPageImages(
  data: ArrayBuffer,
  cssWidth: number,
  /** True once nobody wants the pages any more; drawing stops and the file is released. */
  isCancelled?: () => boolean,
): Promise<PdfPageImages | { failure: PdfReadFailure }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, enableXfa: false });
  try {
    const pdf = await task.promise;
    const images: string[] = [];
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_PAGE_LIMIT); n++) {
      if (isCancelled?.()) break;
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      images.push(canvas.toDataURL("image/png"));
      page.cleanup();
    }
    return { images, pageCount: pdf.numPages };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}
