"use client";

import { strToU8, zipSync } from "fflate";
import {
  formatExportCell,
  sanitizeExportFileName,
  type ReportExportSheet,
} from "@/lib/domain/report-export";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function inlineCell(ref: string, value: string, style = 0): string {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style = 0): string {
  return `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function buildWorksheet(sheet: ReportExportSheet): string {
  const lastColumn = columnName(Math.max(0, sheet.columns.length - 1));
  const titleRows = [
    `<row r="1" ht="25" customHeight="1">${inlineCell("A1", sheet.companyName, 2)}</row>`,
    `<row r="2" ht="23" customHeight="1">${inlineCell("A2", sheet.title, 3)}</row>`,
    `<row r="3">${inlineCell("A3", sheet.subtitle, 4)}</row>`,
    `<row r="4">${inlineCell("A4", `Currency: ${sheet.currencyCode}`, 4)}</row>`,
  ];
  const headerRow = `<row r="6" ht="22" customHeight="1">${sheet.columns
    .map((column, index) => inlineCell(`${columnName(index)}6`, column.header, 1))
    .join("")}</row>`;
  const dataRows = sheet.rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 7;
    const cells = sheet.columns.map((column, columnIndex) => {
      const ref = `${columnName(columnIndex)}${excelRow}`;
      const value = row[column.key];
      if (typeof value === "number") {
        const style = column.kind === "money" ? 5 : column.kind === "percent" ? 6 : 0;
        return numberCell(ref, column.kind === "percent" ? value / 100 : value, style);
      }
      return inlineCell(ref, value === null || value === undefined ? "" : String(value));
    });
    return `<row r="${excelRow}">${cells.join("")}</row>`;
  });
  const columns = sheet.columns
    .map((column, index) => {
      const number = index + 1;
      return `<col min="${number}" max="${number}" width="${column.width ?? 18}" customWidth="1"/>`;
    })
    .join("");
  const lastRow = Math.max(6, sheet.rows.length + 6);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${columns}</cols>
  <sheetData>${titleRows.join("")}${headerRow}${dataRows.join("")}</sheetData>
  <autoFilter ref="A6:${lastColumn}${lastRow}"/>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function xlsxFiles(sheet: ReportExportSheet): Record<string, Uint8Array> {
  const now = new Date().toISOString();
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="191029"/>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%;[Red]-0.0%"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FF0F172A"/><sz val="16"/><name val="Aptos Display"/></font>
    <font><b/><color rgb="FF0F766E"/><sz val="14"/><name val="Aptos Display"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFDCE3EA"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="left"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    "xl/worksheets/sheet1.xml": buildWorksheet(sheet),
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(sheet.title)}</dc:title><dc:creator>${escapeXml(sheet.companyName)}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>One Book</Application></Properties>`,
  };
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)]));
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Save an already-built CSV. The byte-order mark is what makes Excel read the
 * file as UTF-8 instead of the local code page, which otherwise mangles any
 * non-ASCII name in an exported report.
 */
export function downloadCsvFile(csv: string, fileName: string): void {
  download(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }), fileName);
}

export async function exportReportToExcel(sheet: ReportExportSheet): Promise<void> {
  const bytes = buildReportXlsx(sheet);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  download(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${sanitizeExportFileName(sheet.fileName)}.xlsx`,
  );
}

export function buildReportXlsx(sheet: ReportExportSheet): Uint8Array {
  return zipSync(xlsxFiles(sheet), { level: 6 });
}

export async function exportReportToPdf(sheet: ReportExportSheet): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({
    orientation: sheet.columns.length > 5 ? "landscape" : "portrait",
    unit: "pt",
    format: "letter",
  });
  const autoTable = autoTableModule.default;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.text(sheet.companyName, 40, 42);
  doc.setTextColor(15, 118, 110);
  doc.setFontSize(18);
  doc.text(sheet.title, 40, 66);
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(sheet.subtitle, 40, 84);
  doc.text(`Currency: ${sheet.currencyCode}`, 40, 98);

  autoTable(doc, {
    startY: 112,
    head: [sheet.columns.map((column) => column.header)],
    body: sheet.rows.map((row) =>
      sheet.columns.map((column) =>
        formatExportCell(
          row[column.key] ?? null,
          column.kind ?? "text",
          sheet.currencyCode,
        ),
      ),
    ),
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255] },
    columnStyles: Object.fromEntries(
      sheet.columns.map((column, index) => [
        index,
        {
          halign:
            column.kind === "money" || column.kind === "number" || column.kind === "percent"
              ? "right"
              : "left",
        },
      ]),
    ),
    didDrawPage: () => {
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Generated ${new Date().toLocaleString("en-US")} · Page ${page}`,
        40,
        doc.internal.pageSize.getHeight() - 24,
      );
    },
  });
  doc.save(`${sanitizeExportFileName(sheet.fileName)}.pdf`);
}
