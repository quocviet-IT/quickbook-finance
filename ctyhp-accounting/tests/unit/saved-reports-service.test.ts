import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storage = {
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
};
vi.mock("@/lib/db/storage-admin", () => ({
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const {
  SavedReportError,
  archiveSavedReport,
  createSavedReportDownloadUrl,
  createSavedReportUploadTicket,
  readSavedReportText,
  registerSavedReport,
} = await import("@/lib/services/saved-reports");

/** A Supabase client stub that answers exactly the calls the service makes. */
function stubClient(options: {
  row?: Record<string, unknown> | null;
  rpcError?: { message: string; code?: string };
}) {
  return {
    rpc: vi.fn(async () => ({
      data: options.rpcError ? null : "3f2c1b8e-0000-4000-8000-000000000001",
      error: options.rpcError ?? null,
    })),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: options.row ?? null, error: null }),
        }),
      }),
    }),
  } as never;
}

const csvRow = {
  id: "3f2c1b8e-0000-4000-8000-000000000001",
  file_name: "pnl.csv",
  storage_path: "company/object.csv",
  mime_type: "text/csv",
};

beforeEach(() => {
  storage.createSignedUploadUrl.mockReset();
  storage.createSignedUrl.mockReset();
  storage.download.mockReset();
});

describe("createSavedReportUploadTicket", () => {
  it("returns the path it minted the ticket for", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { path: "ignored", token: "tok" },
      error: null,
    });
    const ticket = await createSavedReportUploadTicket(
      "6d0f1e2a-1111-4222-8333-444455556666",
      "text/csv",
    );
    expect(ticket.token).toBe("tok");
    expect(ticket.path.startsWith("6d0f1e2a-1111-4222-8333-444455556666/")).toBe(true);
    expect(ticket.path.endsWith(".csv")).toBe(true);
  });

  it("does not swallow a storage failure", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "no bucket" } });
    await expect(createSavedReportUploadTicket("c", "text/csv")).rejects.toThrow(SavedReportError);
  });
});

describe("registerSavedReport", () => {
  const input = {
    title: "Wave Profit and Loss 2025",
    source: "wave" as const,
    period_start: null,
    period_end: null,
    notes: null,
    file_name: "pnl.csv",
    storage_path: "company/object.csv",
    mime_type: "text/csv" as const,
    size_bytes: 4096,
    sha256: "a".repeat(64),
  };

  it("returns the new id", async () => {
    await expect(registerSavedReport(stubClient({}), input)).resolves.toBe(
      "3f2c1b8e-0000-4000-8000-000000000001",
    );
  });

  it("passes the database's own refusal through instead of a generic message", async () => {
    const sb = stubClient({ rpcError: { message: "This report is already saved (Wave P&L)" } });
    await expect(registerSavedReport(sb, input)).rejects.toThrow(
      "This report is already saved (Wave P&L)",
    );
  });
});

describe("readSavedReportText", () => {
  it("refuses a format the viewer cannot render, rather than returning bytes as text", async () => {
    const sb = stubClient({ row: { ...csvRow, mime_type: "application/pdf" } });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow(
      "This report cannot be shown as a table",
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("refuses a report this company cannot see", async () => {
    const sb = stubClient({ row: null });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow("Report not found");
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("returns the text once the session client has confirmed the row", async () => {
    storage.download.mockResolvedValue({
      data: new Blob(["Account,Balance\nCash,1\n"]),
      error: null,
    });
    await expect(readSavedReportText(stubClient({ row: csvRow }), csvRow.id)).resolves.toContain(
      "Account,Balance",
    );
  });
});

describe("createSavedReportDownloadUrl", () => {
  it("asks for a download rather than an inline view", async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/y" }, error: null });
    const result = await createSavedReportDownloadUrl(stubClient({ row: csvRow }), csvRow.id);
    expect(result).toEqual({ url: "https://x/y", fileName: "pnl.csv" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith("company/object.csv", 60, {
      download: "pnl.csv",
    });
  });

  it("refuses a report the session cannot see", async () => {
    await expect(createSavedReportDownloadUrl(stubClient({ row: null }), csvRow.id)).rejects.toThrow(
      "Report not found",
    );
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("archiveSavedReport", () => {
  it("does not swallow the database's refusal", async () => {
    const sb = stubClient({ rpcError: { message: "Not authorized to archive a report" } });
    await expect(archiveSavedReport(sb, csvRow.id, "wrong file")).rejects.toThrow(
      "Not authorized to archive a report",
    );
  });
});
