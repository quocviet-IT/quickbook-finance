import { strToU8, unzipSync, zipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  archivePathFor,
  buildManifest,
  EXPORT_TABLES,
  exportFileName,
  sha256Hex,
  SENSITIVE_TABLE,
  toCsv,
} from "@/lib/domain/company-export";
import {
  collectExportDatasets,
  readControlTotals,
  readSchemaVersion,
} from "@/lib/services/company-export";
import { closeE2eSession, openE2eSession } from "./support/session";

/**
 * Exercises the same path the Server Action takes — permission gate, paged
 * reads under the caller's RLS, packaging, and the audit RPC — against the real
 * database. The action itself is a thin wrapper over exactly these calls.
 */
describe("company data export over HTTPS", () => {
  it("packages every table and proves the manifest against the live ledger", async () => {
    const { sb, today } = await openE2eSession();

    try {
      const { data: allowed, error: permError } = await sb.rpc("acc_has_permission", {
        p_key: "company.export",
      });
      expect(permError, `acc_has_permission failed: ${permError?.message}`).toBeNull();
      expect(allowed, "the test administrator must hold company.export").toBe(true);

      const generatedAt = new Date().toISOString();
      const [datasets, totals, schemaVersion] = await Promise.all([
        collectExportDatasets(sb),
        readControlTotals(sb, today),
        readSchemaVersion(sb),
      ]);

      // Everything in the catalogue plus the sensitive table, and nothing else.
      expect(datasets.length).toBe(EXPORT_TABLES.length + 1);
      expect(datasets.filter((d) => d.sensitive).map((d) => d.table)).toEqual([SENSITIVE_TABLE]);

      const entries: Record<string, Uint8Array> = {};
      const files: Array<{ path: string; sha256: string; rowCount: number }> = [];
      let totalRows = 0;
      for (const dataset of datasets) {
        const path = archivePathFor(dataset.table);
        const csv = toCsv(dataset.rows, dataset.columns);
        entries[path] = strToU8(csv);
        files.push({ path, sha256: await sha256Hex(csv), rowCount: dataset.rows.length });
        totalRows += dataset.rows.length;
      }
      const manifest = buildManifest({
        datasets,
        files,
        totals,
        controlTotalsAsOf: today,
        schemaVersion,
        generatedAt,
        actorEmail: "e2e@ctyhp.vn",
      });
      entries["manifest.json"] = strToU8(manifest);
      const zip = zipSync(entries, { level: 6 });

      // The archive must survive a round trip and stay self-describing.
      const unpacked = unzipSync(zip);
      expect(Object.keys(unpacked)).toContain("manifest.json");
      expect(Object.keys(unpacked)).toContain("sensitive/vendor-tax.csv");
      expect(Object.keys(unpacked)).toContain("attachments.csv");
      expect(Object.keys(unpacked)).toContain("data/acc_journal_line.csv");
      const parsed = JSON.parse(strFromU8(unpacked["manifest.json"]));
      expect(parsed.schemaVersion).toBe(schemaVersion);
      expect(parsed.containsSensitiveData).toBe(true);
      expect(parsed.excludedTables).toContain("acc_bank_connection_secret");
      expect(Object.keys(unpacked)).not.toContain("data/acc_bank_connection_secret.csv");

      // Every file's checksum must match the bytes actually shipped.
      for (const file of parsed.files) {
        const bytes = unpacked[file.path];
        expect(bytes, `${file.path} is listed in the manifest but missing`).toBeTruthy();
        expect(await sha256Hex(strFromU8(bytes)), `${file.path} checksum`).toBe(file.sha256);
      }

      // Control totals are the acceptance test for a restore, so they are read
      // again independently rather than trusted from the packaging pass.
      const { data: balanceRows } = await sb.rpc("acc_ledger_balances", {
        p_from: "1900-01-01",
        p_to: today,
      });
      const debit = (balanceRows ?? []).reduce(
        (sum: number, row: { debit_base: number }) => sum + Number(row.debit_base),
        0,
      );
      const credit = (balanceRows ?? []).reduce(
        (sum: number, row: { credit_base: number }) => sum + Number(row.credit_base),
        0,
      );
      expect(parsed.controlTotalsAsOf, "the manifest must date its figures").toBe(today);
      expect(parsed.controlTotals.trialBalanceDebitMinor).toBe(debit);
      expect(parsed.controlTotals.trialBalanceCreditMinor).toBe(credit);
      expect(debit, "the exported ledger must be balanced").toBe(credit);

      const { count: journalLines } = await sb
        .from("acc_journal_line")
        .select("id", { count: "exact", head: true });
      expect(parsed.controlTotals.journalLineCount).toBe(journalLines);
      const journalFile = parsed.files.find(
        (f: { path: string }) => f.path === "data/acc_journal_line.csv",
      );
      expect(
        journalFile.rowCount,
        "the journal CSV must hold every line the manifest counts",
      ).toBe(journalLines);

      // A taxpayer identifier may live in sensitive/ and nowhere else.
      const tins = (
        datasets.find((d) => d.table === SENSITIVE_TABLE)?.rows ?? []
      )
        .map((row) => String(row.tin ?? ""))
        .filter((tin) => tin.length > 3);
      for (const [path, bytes] of Object.entries(unpacked)) {
        if (path.startsWith("sensitive/")) continue;
        const text = strFromU8(bytes);
        for (const tin of tins) {
          expect(text.includes(tin), `${path} must not carry a taxpayer identifier`).toBe(false);
        }
      }

      // Recording the export is part of the export: an unrecorded download of
      // taxpayer data is what US-FR-013 forbids.
      const manifestSha256 = await sha256Hex(manifest);
      const { data: auditId, error: auditError } = await sb.rpc("acc_log_company_export", {
        p_summary: {
          generated_at: generatedAt,
          schema_version: schemaVersion,
          manifest_sha256: manifestSha256,
          table_count: datasets.length,
          total_rows: totalRows,
          included_sensitive: true,
        },
      });
      expect(auditError, `acc_log_company_export failed: ${auditError?.message}`).toBeNull();

      const { data: auditRow } = await sb
        .from("acc_audit_log")
        .select("table_name, action, after_json")
        .eq("id", auditId)
        .single();
      expect(auditRow?.table_name).toBe("acc_company_export");
      expect(auditRow?.action).toBe("export");
      expect(auditRow?.after_json).toMatchObject({
        manifest_sha256: manifestSha256,
        table_count: datasets.length,
        included_sensitive: true,
      });
      const auditText = JSON.stringify(auditRow?.after_json);
      for (const tin of tins) {
        expect(auditText.includes(tin), "the audit row must not carry a TIN").toBe(false);
      }

      // The RPC refuses a summary that smuggles exported rows into the audit.
      const { error: rejected } = await sb.rpc("acc_log_company_export", {
        p_summary: { generated_at: generatedAt, rows: [{ tin: "12-3456789" }] },
      });
      expect(rejected, "a summary carrying data must be refused").not.toBeNull();

      expect(exportFileName("CTYHP", generatedAt)).toMatch(/^ctyhp-company-export-\d{4}-\d{2}-\d{2}\.zip$/);
      // eslint-disable-next-line no-console
      console.info(
        `export: ${datasets.length} tables, ${totalRows} rows, ${(zip.length / 1024).toFixed(1)} KiB, manifest ${manifestSha256.slice(0, 12)}…`,
      );
      // eslint-disable-next-line no-console
      console.info(`control totals: ${JSON.stringify(parsed.controlTotals)}`);
    } finally {
      await closeE2eSession(sb);
    }
  });
});
