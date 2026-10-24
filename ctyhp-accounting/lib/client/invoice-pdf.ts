"use client";

import type { jsPDF } from "jspdf";
import type { InvoiceDocument, PrintedDocument } from "@/lib/domain/invoice-document";
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";
import type { EstimateDocument } from "@/lib/domain/estimate-document";
import type { SalesReceiptDocument } from "@/lib/domain/sales-receipts";

/**
 * What this renderer draws: an invoice, or an estimate, which adds a closing
 * line under its note (lib/domain/estimate-document), or a sales receipt,
 * which also names its customer "Sold to" (lib/domain/sales-receipts).
 */
export type RenderableDocument = PrintedDocument & { footer?: string | null; partyHeading?: string };

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const ACCENT: [number, number, number] = [15, 118, 110];
const MARGIN = 48;

/**
 * The PDF library, fetched the first time somebody actually wants a PDF.
 *
 * Loading it at the top of this module put 123 KB into the /invoices bundle
 * for every reader who opened the list — measured on production, 25 August
 * 2026 — when only the few who click Download ever need it. The type import
 * above is erased at build time and costs nothing.
 *
 * lib/client/report-export.ts has always loaded the same library this way; it
 * is the pattern, and this module was the exception to it.
 */
async function pdfLibrary() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

/**
 * Draws the document model produced by lib/domain/invoice-document, or the
 * estimate's from lib/domain/estimate-document, which shares its layout. Every
 * string here already came from those modules — this file decides placement,
 * never content.
 */
export async function renderInvoicePdf(doc: RenderableDocument): Promise<jsPDF> {
  const { jsPDF, autoTable } = await pdfLibrary();
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const rightEdge = pageWidth - MARGIN;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(...INK);
  pdf.text(doc.seller.displayName, MARGIN, 64);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  let sellerY = 80;
  if (doc.seller.legalLine) {
    pdf.text(doc.seller.legalLine, MARGIN, sellerY);
    sellerY += 12;
  }
  for (const line of doc.seller.lines) {
    pdf.text(line, MARGIN, sellerY);
    sellerY += 12;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(...ACCENT);
  pdf.text(doc.title, rightEdge, 64, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  let metaY = 82;
  for (const entry of doc.meta) {
    pdf.text(`${entry.label}: ${entry.value}`, rightEdge, metaY, { align: "right" });
    metaY += 13;
  }

  const billToTop = Math.max(sellerY, metaY) + 18;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  pdf.text(doc.partyHeading ?? "BILL TO", MARGIN, billToTop);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  pdf.text(doc.billTo.name, MARGIN, billToTop + 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  let billY = billToTop + 30;
  for (const line of doc.billTo.lines) {
    pdf.text(line, MARGIN, billY);
    billY += 12;
  }

  autoTable(pdf, {
    startY: billY + 16,
    head: [["Description", "Qty", "Unit price", "Amount"]],
    body: doc.lines.map((line) => [line.description, line.quantity, line.unitPrice, line.amount]),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 6, textColor: INK },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255] },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 90 },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // @ts-expect-error jspdf-autotable augments the document at runtime.
  let totalsY = (pdf.lastAutoTable?.finalY ?? billY) + 22;
  doc.totals.forEach((total, index) => {
    // The last row is the figure the reader acts on: Balance due on an
    // invoice, which the model always puts last, and Total on an estimate,
    // which owes nothing.
    const emphasise = index === doc.totals.length - 1;
    pdf.setFont("helvetica", emphasise ? "bold" : "normal");
    pdf.setFontSize(emphasise ? 11 : 9);
    pdf.setTextColor(...(emphasise ? INK : MUTED));
    pdf.text(total.label, rightEdge - 140, totalsY, { align: "right" });
    pdf.text(total.amount, rightEdge, totalsY, { align: "right" });
    totalsY += emphasise ? 18 : 14;
  });

  let footY = totalsY + 10;
  if (doc.memo) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...MUTED);
    const memoLines: string[] = pdf.splitTextToSize(doc.memo, pageWidth - MARGIN * 2);
    pdf.text(memoLines, MARGIN, footY);
    footY += memoLines.length * pdf.getLineHeight() + 8;
  }

  if (doc.footer) {
    // Starts a page of its own rather than running into the page number.
    if (footY > pdf.internal.pageSize.getHeight() - 48) {
      pdf.addPage();
      footY = 64;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(doc.footer, pageWidth - MARGIN * 2), MARGIN, footY);
  }

  if (doc.watermark) {
    // Drawn last so it sits above the content a reader might otherwise act on.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(96);
    pdf.setTextColor(226, 232, 240);
    pdf.text(doc.watermark, pageWidth / 2, pdf.internal.pageSize.getHeight() / 2, {
      align: "center",
      angle: 30,
    });
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(
      `${doc.title} · Page ${page} of ${pages}`,
      pageWidth / 2,
      pdf.internal.pageSize.getHeight() - 24,
      { align: "center" },
    );
  }

  return pdf;
}

export async function downloadInvoicePdf(
  doc: InvoiceDocument,
  invoiceNumber: string | null,
  issueDate: string,
): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.save(invoiceDocumentFileName(invoiceNumber, issueDate));
}

/** Saves an estimate under the name its model gives it: `Estimate EST-000001 <customer>.pdf`. */
export async function downloadEstimatePdf(doc: EstimateDocument): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.save(doc.fileName);
}

/** Saves a sales receipt under the name its model gives it: `Sales receipt SR-000001 <customer>.pdf`. */
export async function downloadSalesReceiptPdf(doc: SalesReceiptDocument): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.save(doc.fileName);
}

/** Opens the browser print dialog on the rendered document. */
export async function printInvoicePdf(doc: InvoiceDocument): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.autoPrint().output("dataurlnewwindow");
}
