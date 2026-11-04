import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeOf, splitSqlStatements } from "@/lib/domain/schema-template";

/** A photo of a statement is kept and read with OCR (3.0.5): the dialog and migration 0189. */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const dialog = read("app", "(app)", "banking", "ImportStatementModal.tsx");
const migration = read("supabase", "migrations", "0189_statement_photos.sql");
const code = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("Import statement accepts a photo", () => {
  it("offers JPG and PNG in the file picker", () => {
    const accept = /accept="([^"]+)"/.exec(dialog)?.[1] ?? "";
    for (const part of [".jpg", ".jpeg", ".png", "image/jpeg", "image/png"]) expect(accept).toContain(part);
  });

  it("sends a photo straight to the scanned state, without pdf.js", () => {
    const fn = dialog.slice(dialog.indexOf("function read(chosen: File)"));
    const body = fn.slice(0, fn.indexOf("new FileReader()"));
    expect(body).toMatch(/isPhotoFile\(chosen\)/);
    expect(dialog).toMatch(/async function readPhoto/);
    const photo = dialog.slice(dialog.indexOf("async function readPhoto"), dialog.indexOf("async function readWithOcr"));
    expect(photo).toMatch(/side === "card"[\s\S]*CARD_PDF_NOT_READ/);
    expect(photo).toMatch(/ocrAvailableAction\(\)/);
    expect(photo).toMatch(/token !== reading\.current/);
    expect(photo).toMatch(/kind: "scanned"/);
    expect(photo).not.toMatch(/readPdfStatementFile/);
  });

  it("mentions a photo in the intro", () => {
    expect(dialog).toMatch(/a photo \(JPG or PNG\)/);
  });
});

describe("0189_statement_photos", () => {
  it("keeps a photo and says so in the refusal", () => {
    expect(code).toMatch(/p_mime_type not in \('application\/pdf', 'image\/png', 'image\/jpeg', 'text\/csv', 'text\/plain'\)/);
    expect(code).toContain("A statement file is a PDF, a photo (JPG or PNG), a CSV or a bank download");
  });

  it("is company-scoped on every statement", () => {
    expect(code).not.toMatch(/onebook\./);
    for (const statement of splitSqlStatements(migration)) expect(scopeOf(statement).scope, statement.slice(0, 60)).toBe("company");
  });

  it("keeps the signature, definer rights and grants of 0135", () => {
    expect(code).toMatch(/security definer set search_path = public/);
    expect(code).toMatch(/revoke all on function acc_keep_statement_file\(text, date, date, text, text, text, int, text\) from public, anon;/);
    expect(code).toMatch(/grant execute on function acc_keep_statement_file\(text, date, date, text, text, text, int, text\) to authenticated, service_role;/);
  });
});

describe("a photo is called a photo (3.0.6)", () => {
  const preview = read("app", "(app)", "banking", "PdfStatementPreview.tsx");
  const fromFiles = read("app", "(app)", "banking", "reconcile", "from-files", "FromFilesClient.tsx");

  it("titles the OCR offer by what the file is", () => {
    expect(preview).toMatch(/const title = photo \? OCR_TEXT\.photoTitle : OCR_TEXT\.title/);
    expect(preview).not.toMatch(/title=\{OCR_TEXT\.title\}/);
  });

  it("tells the offer whether the file is a photo, in both places it is shown", () => {
    expect(dialog).toMatch(/<ScannedPdf[\s\S]{0,200}photo=\{chosen \? isPhotoFile\(chosen\) : false\}/);
    expect(fromFiles).toMatch(/<ScannedPdf[\s\S]{0,300}photo=\{isPhotoFile\(scanned\)\}/);
  });

  it("labels a read photo as a photo, not a PDF", () => {
    expect(preview).toMatch(/\(\{statementFileKindLabel\(fileName\)\}\)/);
    expect(preview).not.toMatch(/<\/strong> \(PDF\)/);
  });
});
