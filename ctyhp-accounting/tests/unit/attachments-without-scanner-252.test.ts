import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { documentCanBeAccessed } from "@/lib/domain/documents";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0162_attachments_without_scanner.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

function strip(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 0162", () => {
  const raw = read(`supabase/migrations/${FILE}`);
  const sql = strip(raw);

  it("lands in every company's schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
  });

  it("lets a new upload enter as not scanned, with every other check kept", () => {
    const policy = sql.slice(sql.indexOf("create policy acc_document_attachment_insert"), sql.indexOf(");", sql.indexOf("create policy")) + 2);
    expect(policy).toContain("scan_status = 'not_configured'");
    expect(policy).not.toContain("'pending'");
    for (const kept of [
      "acc_has_permission('documents.manage')",
      "uploaded_by = auth.uid()",
      "status = 'active'",
      "acc_document_storage_path_allowed(storage_path)",
    ]) {
      expect(policy).toContain(kept);
    }
  });

  it("drops the three scan functions and touches nothing else", () => {
    expect(sql).toContain("drop function if exists acc_queue_document_scan(uuid);");
    expect(sql).toContain("drop function if exists acc_begin_document_scan(uuid);");
    expect(sql).toContain("drop function if exists acc_complete_document_scan(uuid, acc_document_scan_status, text, text, text);");
    expect(sql).not.toMatch(/\b(delete from|drop table|drop column|alter table)\b/i);
    expect(sql).not.toContain("storage.objects");
  });
});

describe("the app without a scanner", () => {
  it("registers a new file as not scanned, which opens at once; a blocked one stays shut", () => {
    expect(read("lib/services/documents.ts")).toContain('scan_status: "not_configured"');
    expect(documentCanBeAccessed("not_configured")).toBe(true);
    expect(documentCanBeAccessed("blocked")).toBe(false);
  });

  it("has no scanner, scan job, scan route or scan button left", () => {
    for (const gone of [
      "lib/services/document-scanner.ts",
      "app/api/documents/scan/route.ts",
      "tests/e2e/document-scan.e2e.ts",
      "../services/document-scanner",
    ]) {
      expect(existsSync(join(process.cwd(), gone)), gone).toBe(false);
    }
    expect(read("vercel.json")).not.toContain("/api/documents/scan");
    const drawer = read("components/documents/AttachmentDrawer.tsx");
    expect(drawer).not.toContain("scannerConfigured");
    expect(drawer).not.toContain("rescan");
    expect(read("app/(app)/documents/actions.ts")).not.toContain("rescanDocumentAttachmentAction");
    expect(read(".env.local.example")).not.toContain("DOCUMENT_SCANNER");
  });

  it("puts a file's buttons under its name, counts files in words, and hides the help buttons behind any drawer", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.document-list-item \{\s*flex-direction: column;/);
    expect(css).toMatch(/body:has\(\.ant-drawer-open\) \.assistant-launcher \{\s*visibility: hidden;/);
    expect(read("components/documents/AttachmentDrawer.tsx")).toContain('{plural(attachments.length, "file")}');
  });

  it("still says what keeps the files private", () => {
    const drawer = read("components/documents/AttachmentDrawer.tsx");
    expect(drawer).toContain(
      "Only people allowed to read documents can open these files, each link lasts one minute, and every preview and download is logged.",
    );
  });
});

describe("the 2.52 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.52")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed and dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.52);
    expect(release.date).toBe("2026-10-24");
  });

  it("says uploads work now and what still protects the files", () => {
    for (const words of [
      "uploads a file straight away",
      "with the Scan button and the nightly scan",
      "up to 10 MB",
      "each link lasts one minute",
      "every preview and download is logged",
    ]) {
      expect(said).toContain(words);
    }
  });
});
