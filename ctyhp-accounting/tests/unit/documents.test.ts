import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  defaultDocumentKind,
  documentAttachmentCreateSchema,
  documentCanBeAccessed,
  documentGovernanceSchema,
  documentScannerResponseSchema,
  fileExtensionForMime,
  formatDocumentFileSize,
  validateDocumentFile,
} from "@/lib/domain/documents";

const entityId = "11111111-1111-4111-8111-111111111111";
const storageId = "22222222-2222-4222-8222-222222222222";
const sha256 = "a".repeat(64);

describe("document attachment validation", () => {
  it("accepts a supported private attachment", () => {
    const result = documentAttachmentCreateSchema.safeParse({
      entity_type: "bill",
      entity_id: entityId,
      document_kind: "vendor_bill",
      file_name: "vendor-invoice.pdf",
      storage_path: `bill/${entityId}/${storageId}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 2048,
      sha256,
      description: "Signed vendor invoice",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported and oversized files", () => {
    expect(
      validateDocumentFile({ name: "macro.exe", type: "application/x-msdownload", size: 200 }),
    ).toMatch(/PDF/i);
    expect(
      validateDocumentFile({
        name: "large.pdf",
        type: "application/pdf",
        size: DOCUMENT_MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toMatch(/10 MB/i);
  });

  it("rejects weak hashes and traversal paths", () => {
    const base = {
      entity_type: "expense",
      entity_id: entityId,
      document_kind: "receipt",
      file_name: "receipt.jpg",
      storage_path: `expense/${entityId}/${storageId}.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 1024,
      sha256,
    };
    expect(documentAttachmentCreateSchema.safeParse({ ...base, sha256: "short" }).success).toBe(false);
    expect(
      documentAttachmentCreateSchema.safeParse({
        ...base,
        storage_path: `expense/${entityId}/../receipt.jpg`,
      }).success,
    ).toBe(false);
  });
});

describe("document presentation helpers", () => {
  it("selects practical defaults for core accounting documents", () => {
    expect(defaultDocumentKind("invoice")).toBe("customer_document");
    expect(defaultDocumentKind("bill")).toBe("vendor_bill");
    expect(defaultDocumentKind("expense")).toBe("receipt");
    expect(defaultDocumentKind("purchase_order")).toBe("purchase_order");
  });

  it("uses controlled extensions and readable file sizes", () => {
    expect(fileExtensionForMime("application/pdf")).toBe("pdf");
    expect(fileExtensionForMime("image/jpeg")).toBe("jpg");
    expect(formatDocumentFileSize(1_572_864)).toBe("1.5 MB");
    expect(() => fileExtensionForMime("application/x-msdownload")).toThrow(/unsupported/i);
  });

  it("fails closed while a file is pending, blocked, or errored", () => {
    expect(documentCanBeAccessed("clean")).toBe(true);
    expect(documentCanBeAccessed("not_configured")).toBe(true);
    expect(documentCanBeAccessed("pending")).toBe(false);
    expect(documentCanBeAccessed("blocked")).toBe(false);
    expect(documentCanBeAccessed("error")).toBe(false);
  });

  it("requires a threat name when a scanner blocks a file", () => {
    expect(documentScannerResponseSchema.safeParse({ verdict: "clean" }).success).toBe(true);
    expect(documentScannerResponseSchema.safeParse({ verdict: "blocked" }).success).toBe(false);
    expect(
      documentScannerResponseSchema.safeParse({
        verdict: "blocked",
        engine: "ClamAV",
        threat: "Eicar-Test-Signature",
      }).success,
    ).toBe(true);
  });

  it("validates retention and legal-hold governance changes", () => {
    expect(
      documentGovernanceSchema.safeParse({
        attachment_id: storageId,
        retention_until: "2027-12-31",
        legal_hold: true,
        reason: "Tax audit preservation",
      }).success,
    ).toBe(true);
    expect(
      documentGovernanceSchema.safeParse({
        attachment_id: storageId,
        retention_until: "not-a-date",
        legal_hold: false,
        reason: "",
      }).success,
    ).toBe(false);
  });
});
