import { describe, expect, it } from "vitest";
import {
  attachmentExtension,
  attachmentIsImage,
  attachmentStoragePath,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_FILES,
  formatBytes,
  isAllowedAttachmentType,
  rejectAdditionalAttachment,
  rejectAttachment,
  safeAttachmentName,
} from "@/lib/domain/feedback-attachment";

const REPORT = "1e709a3f-004f-4151-9ed6-b867640d02e1";
const OBJECT = "6c1252dc-7982-49d3-b864-b1e0b454a415";

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "invoice.pdf",
  type: "application/pdf",
  size: 200_000,
  ...over,
});

describe("accepted types", () => {
  it("takes the files a reporter actually has: images, PDF, CSV, spreadsheet, text", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]) {
      expect(isAllowedAttachmentType(type), type).toBe(true);
    }
  });

  it("refuses anything executable or unknown", () => {
    expect(isAllowedAttachmentType("application/x-msdownload")).toBe(false);
    expect(isAllowedAttachmentType("application/zip")).toBe(false);
    expect(isAllowedAttachmentType("")).toBe(false);
  });

  it("maps each type to the extension the storage path must end in", () => {
    expect(attachmentExtension("image/jpeg")).toBe("jpg");
    expect(attachmentExtension("application/pdf")).toBe("pdf");
    expect(attachmentExtension("application/zip")).toBeNull();
  });

  it("knows which attachments can be shown as a picture", () => {
    expect(attachmentIsImage("image/webp")).toBe(true);
    expect(attachmentIsImage("application/pdf")).toBe(false);
  });
});

describe("rejectAttachment", () => {
  it("accepts a normal file", () => {
    expect(rejectAttachment(file())).toBeNull();
  });

  it("names the file it is refusing and why", () => {
    expect(rejectAttachment(file({ name: "hack.exe", type: "application/x-msdownload" }))).toContain(
      "hack.exe",
    );
    expect(rejectAttachment(file({ type: "application/zip" }))).toMatch(/not a type we accept/);
  });

  it("refuses an empty file", () => {
    expect(rejectAttachment(file({ size: 0 }))).toContain("is empty");
  });

  it("refuses a file over the limit, quoting both sizes", () => {
    const message = rejectAttachment(file({ size: FEEDBACK_ATTACHMENT_MAX_BYTES + 1 }))!;
    expect(message).toContain("10.0 MB");
  });

  it("accepts a file exactly on the limit", () => {
    expect(rejectAttachment(file({ size: FEEDBACK_ATTACHMENT_MAX_BYTES }))).toBeNull();
  });
});

describe("rejectAdditionalAttachment", () => {
  it("allows files up to the count limit", () => {
    const existing = Array.from({ length: FEEDBACK_ATTACHMENT_MAX_FILES - 1 }, () => file());
    expect(rejectAdditionalAttachment(existing, file())).toBeNull();
  });

  it("refuses the one that would go past it", () => {
    const existing = Array.from({ length: FEEDBACK_ATTACHMENT_MAX_FILES }, () => file());
    expect(rejectAdditionalAttachment(existing, file())).toContain("at most 5 attachments");
  });
});

describe("formatBytes", () => {
  it("reads the way a person would say it", () => {
    expect(formatBytes(48)).toBe("48 bytes");
    expect(formatBytes(812 * 1024)).toBe("812 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});

describe("attachmentStoragePath", () => {
  it("builds the path the storage policy accepts", () => {
    expect(attachmentStoragePath(REPORT, OBJECT, "application/pdf")).toBe(
      `${REPORT}/${OBJECT}.pdf`,
    );
    expect(attachmentStoragePath(REPORT, OBJECT, "image/jpeg")).toBe(`${REPORT}/${OBJECT}.jpg`);
  });

  it("refuses to build a path for a type that cannot be stored", () => {
    expect(() => attachmentStoragePath(REPORT, OBJECT, "application/zip")).toThrow(
      /Unsupported attachment type/,
    );
  });
});

describe("safeAttachmentName", () => {
  it("keeps an ordinary name", () => {
    expect(safeAttachmentName(" vendor bill.pdf ")).toBe("vendor bill.pdf");
  });

  it("never stores an empty name", () => {
    expect(safeAttachmentName("   ")).toBe("attachment");
  });

  it("flattens line breaks and trims to the column length", () => {
    expect(safeAttachmentName("two\nlines.pdf")).toBe("two lines.pdf");
    expect(safeAttachmentName("x".repeat(300))).toHaveLength(200);
  });
});
