import { describe, expect, it } from "vitest";
import {
  archivePathFor,
  buildManifest,
  EXCLUDED_TABLES,
  EXPORT_TABLES,
  exportFileName,
  sha256Hex,
  SENSITIVE_TABLE,
  toCsv,
} from "@/lib/domain/company-export";

describe("toCsv", () => {
  it("writes a header row followed by one row per record", () => {
    const csv = toCsv([{ id: "1", name: "Acme" }], ["id", "name"]);
    expect(csv).toBe("id,name\r\n1,Acme");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv([{ note: 'He said "go", then\nleft' }], ["note"]);
    expect(csv).toBe('note\r\n"He said ""go"", then\nleft"');
  });

  it("neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ memo: "=cmd|'/c calc'!A1" }], ["memo"]);
    expect(csv).toBe("memo\r\n\"'=cmd|'/c calc'!A1\"");
  });

  it("writes an empty cell for null and undefined", () => {
    const csv = toCsv([{ a: null, b: undefined }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n,");
  });

  it("serialises objects as JSON so jsonb columns survive", () => {
    const csv = toCsv([{ payload: { rows: 2 } }], ["payload"]);
    expect(csv).toBe('payload\r\n"{""rows"":2}"');
  });
});

describe("table catalogue", () => {
  it("never exports the encrypted bank feed secrets", () => {
    expect(EXCLUDED_TABLES).toContain("acc_bank_connection_secret");
    expect(EXPORT_TABLES).not.toContain("acc_bank_connection_secret");
  });

  it("keeps vendor tax profiles out of the plain data set", () => {
    expect(EXPORT_TABLES).not.toContain(SENSITIVE_TABLE);
  });

  it("exports the migration ledger so the archive stays interpretable", () => {
    expect(EXPORT_TABLES).toContain("acc_schema_migrations");
  });

  it("exports the journal, the source of every reported figure", () => {
    expect(EXPORT_TABLES).toContain("acc_journal_entry");
    expect(EXPORT_TABLES).toContain("acc_journal_line");
  });

  it("lists no table twice", () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("buildManifest", () => {
  const manifest = () =>
    JSON.parse(
      buildManifest({
        datasets: [
          { table: "acc_account", columns: ["id"], rows: [{ id: "1" }], sensitive: false },
          {
            table: "acc_vendor_tax_profile",
            columns: ["tin"],
            rows: [{ tin: "12-3456789" }],
            sensitive: true,
          },
        ],
        files: [
          { path: "data/acc_account.csv", sha256: "aa", rowCount: 1 },
          { path: "sensitive/vendor-tax.csv", sha256: "bb", rowCount: 1 },
        ],
        totals: {
          trialBalanceDebitMinor: 24_625_360,
          trialBalanceCreditMinor: 24_625_360,
          arTotalMinor: 850_548,
          apTotalMinor: 1_586_500,
          journalLineCount: 120,
        },
        schemaVersion: "0059_company_export.sql",
        generatedAt: "2026-07-29T02:00:00.000Z",
        actorEmail: "admin@ctyhp.vn",
      }),
    );

  it("records the control totals a restore is checked against", () => {
    expect(manifest().controlTotals).toEqual({
      trialBalanceDebitMinor: 24_625_360,
      trialBalanceCreditMinor: 24_625_360,
      arTotalMinor: 850_548,
      apTotalMinor: 1_586_500,
      journalLineCount: 120,
    });
  });

  it("flags the sensitive file so nobody shares the archive unaware", () => {
    expect(manifest().containsSensitiveData).toBe(true);
    expect(
      manifest().files.find((f: { path: string }) => f.path.startsWith("sensitive/")),
    ).toMatchObject({ sha256: "bb", rowCount: 1 });
  });

  it("never repeats a row value inside the manifest", () => {
    expect(JSON.stringify(manifest())).not.toContain("12-3456789");
  });

  it("names the migration the data was written under", () => {
    expect(manifest().schemaVersion).toBe("0059_company_export.sql");
  });
});

describe("archivePathFor", () => {
  it("puts an ordinary table under data/", () => {
    expect(archivePathFor("acc_invoice")).toBe("data/acc_invoice.csv");
  });

  it("isolates vendor tax profiles", () => {
    expect(archivePathFor(SENSITIVE_TABLE)).toBe("sensitive/vendor-tax.csv");
  });

  it("promotes the attachment inventory to the archive root", () => {
    expect(archivePathFor("acc_document_attachment")).toBe("attachments.csv");
  });
});

describe("exportFileName", () => {
  it("is filesystem safe and dated", () => {
    expect(exportFileName("CTY HP / Jewelry", "2026-07-29T02:00:00.000Z")).toBe(
      "cty-hp-jewelry-company-export-2026-07-29.zip",
    );
  });

  it("falls back when the company has no usable name", () => {
    expect(exportFileName("///", "2026-07-29T02:00:00.000Z")).toBe(
      "company-company-export-2026-07-29.zip",
    );
  });
});
