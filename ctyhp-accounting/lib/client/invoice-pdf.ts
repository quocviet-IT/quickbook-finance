"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceDocument } from "@/lib/domain/invoice-document";
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const ACCENT: [number, number, number] = [15, 118, 110];
const MARGIN = 48;

/**
 * Draws the document model produced by lib/domain/invoice-document. Every
 * string here already came from that module — this file decides placement,
 * never content.
 */
export function renderInvoicePdf(doc: InvoiceDocument): jsPDF {
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
  pdf.text("BILL TO", MARGIN, billToTop);
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
  for (const total of doc.totals) {
    const emphasise = total.label === "Balance due";
    pdf.setFont("helvetica", emphasise ? "bold" : "normal");
    pdf.setFontSize(emphasise ? 11 : 9);
    pdf.setTextColor(...(emphasise ? INK : MUTED));
    pdf.text(total.label, rightEdge - 140, totalsY, { align: "right" });
    pdf.text(total.amount, rightEdge, totalsY, { align: "right" });
    totalsY += emphasise ? 18 : 14;
  }

  if (doc.memo) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...MUTED);
    pdf.text(pdf.splitTextToSize(doc.memo, pageWidth - MARGIN * 2), MARGIN, totalsY + 10);
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

export function downloadInvoicePdf(
  doc: InvoiceDocument,
  invoiceNumber: string | null,
  issueDate: string,
): void {
  renderInvoicePdf(doc).save(invoiceDocumentFileName(invoiceNumber, issueDate));
}

/** Opens the browser print dialog on the rendered document. */
export function printInvoicePdf(doc: InvoiceDocument): void {
  renderInvoicePdf(doc).autoPrint().output("dataurlnewwindow");
}
