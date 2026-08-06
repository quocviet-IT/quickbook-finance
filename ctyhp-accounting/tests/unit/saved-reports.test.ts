import { describe, expect, it } from "vitest";
import { parseCsvGrid, parseCsv } from "@/lib/csv";
import {
  isTabularSavedReport,
  savedReportPreview,
  savedReportRegisterSchema,
  savedReportArchiveSchema,
  savedReportStoragePath,
  validateSavedReportFile,
  SAVED_REPORT_MAX_BYTES,
} from "@/lib/domain/saved-reports";

describe("parseCsvGrid", () => {
  it("keeps column order, blank headers and duplicates that keying would lose", () => {
    const grid = parseCsvGrid("Date,,Date\r\n2026-01-01,x,2026-02-01\r\n");
    expect(grid).toEqual([
      ["Date", "", "Date"],
      ["2026-01-01", "x", "2026-02-01"],
    ]);
  });

  it("still keys records the way every existing caller expects", () => {
    expect(parseCsv("Name,Amount\r\nAcme,10\r\n")).toEqual([{ name: "Acme", amount: "10" }]);
  });
});

describe("savedReportStoragePath", () => {
  it("puts the company first so an object can be traced back from the bucket", () => {
    const path = savedReportStoragePath(
      "6d0f1e2a-1111-4222-8333-444455556666",
      "text/csv",
      "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
    );
    expect(path).toBe(
      "6d0f1e2a-1111-4222-8333-444455556666/aaaabbbb-cccc-4ddd-8eee-ffff00001111.csv",
    );
  });

  it("uses the extension the mime type implies, not the one the file claimed", () => {
    expect(savedReportStoragePath("c", "application/pdf", "o")).toBe("c/o.pdf");
  });
});

describe("isTabularSavedReport", () => {
  it("is true only for the format the viewer can actually render", () => {
    expect(isTabularSavedReport("text/csv")).toBe(true);
    expect(isTabularSavedReport("application/pdf")).toBe(false);
    expect(
      isTabularSavedReport("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(false);
  });
});

describe("validateSavedReportFile", () => {
  it("accepts a normal CSV export", () => {
    expect(
      validateSavedReportFile({ name: "pnl-2025.csv", type: "text/csv", size: 4096 }),
    ).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(validateSavedReportFile({ name: "a.csv", type: "text/csv", size: 0 })).toBe(
      "The selected file is empty.",
    );
  });

  it("names the limit when the file is too large", () => {
    expect(
      validateSavedReportFile({
        name: "a.csv",
        type: "text/csv",
        size: SAVED_REPORT_MAX_BYTES + 1,
      }),
    ).toBe("The file must be 10 MB or smaller.");
  });

  it("names the formats it will take when the type is not one of them", () => {
    expect(validateSavedReportFile({ name: "a.docx", type: "application/msword", size: 10 })).toBe(
      "Use CSV, PDF, XLSX, PNG, or JPG.",
    );
  });
});

describe("savedReportPreview", () => {
  it("splits the header off and reports that nothing was cut", () => {
    const preview = savedReportPreview("Account,Balance\r\nCash,100\r\nBank,200\r\n");
    expect(preview.headers).toEqual(["Account", "Balance"]);
    expect(preview.rows).toEqual([
      ["Cash", "100"],
      ["Bank", "200"],
    ]);
    expect(preview.truncated).toBe(false);
  });

  it("stops at the limit and says so, rather than rendering ten thousand rows", () => {
    const text = ["Account,Balance", ...Array.from({ length: 5 }, (_, i) => `A${i},${i}`)].join(
      "\n",
    );
    const preview = savedReportPreview(text, 2);
    expect(preview.rows).toHaveLength(2);
    expect(preview.truncated).toBe(true);
  });

  it("returns nothing rather than throwing on an empty file", () => {
    expect(savedReportPreview("")).toEqual({ headers: [], rows: [], truncated: false });
  });
});

describe("savedReportRegisterSchema", () => {
  const valid = {
    title: "Wave Profit and Loss 2025",
    source: "wave" as const,
    period_start: "2025-01-01",
    period_end: "2025-12-31",
    notes: null,
    file_name: "pnl.csv",
    storage_path: "company/object.csv",
    mime_type: "text/csv",
    size_bytes: 4096,
    sha256: "a".repeat(64),
  };

  it("accepts a complete report", () => {
    expect(savedReportRegisterSchema.parse(valid).title).toBe("Wave Profit and Loss 2025");
  });

  it("refuses a blank title", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
  });

  it("refuses a period that ends before it starts", () => {
    const result = savedReportRegisterSchema.safeParse({
      ...valid,
      period_start: "2025-12-31",
      period_end: "2025-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a report with no period at all", () => {
    expect(
      savedReportRegisterSchema.safeParse({ ...valid, period_start: null, period_end: null })
        .success,
    ).toBe(true);
  });

  it("refuses a source nobody defined", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, source: "sage" }).success).toBe(false);
  });

  it("refuses a hash that is not a sha256", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, sha256: "abc" }).success).toBe(false);
  });
});

describe("savedReportArchiveSchema", () => {
  it("requires a reason, because an archived report with no reason explains nothing", () => {
    expect(
      savedReportArchiveSchema.safeParse({ id: crypto.randomUUID(), reason: "" }).success,
    ).toBe(false);
  });
});
