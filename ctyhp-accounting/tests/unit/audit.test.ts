import { describe, expect, it } from "vitest";
import {
  auditTrailCsv,
  auditTrailFileName,
  auditTrailRows,
  diffAuditEntry,
  documentAttribution,
  formatActor,
  formatAuditTimestamp,
  formatAuditValue,
  summarizeAuditChanges,
  type AuditEntryLike,
} from "@/lib/domain/audit";

const ISSUE: AuditEntryLike = {
  table_name: "acc_invoice",
  record_id: "6c1252dc-7982-49d3-b864-b1e0b454a415",
  action: "post",
  actor_email: "admin@ctyhp.vn",
  created_at: "2026-07-31T01:05:07.262484+00:00",
  before_json: {
    id: "6c1252dc-7982-49d3-b864-b1e0b454a415",
    invoice_number: null,
    status: "draft",
    total_minor: 8552,
    updated_at: "2026-07-30T09:00:00+00:00",
  },
  after_json: {
    id: "6c1252dc-7982-49d3-b864-b1e0b454a415",
    invoice_number: "INV-000014",
    status: "issued",
    total_minor: 8552,
    updated_at: "2026-07-31T01:05:07+00:00",
  },
};

describe("diffAuditEntry", () => {
  it("reports only the fields whose value moved", () => {
    expect(diffAuditEntry(ISSUE)).toEqual([
      { field: "invoice_number", before: "", after: "INV-000014" },
      { field: "status", before: "draft", after: "issued" },
    ]);
  });

  it("keeps the housekeeping stamps out unless they are asked for", () => {
    const fields = diffAuditEntry(ISSUE, { includeHousekeeping: true }).map((c) => c.field);
    expect(fields).toEqual(["invoice_number", "status", "updated_at"]);
  });

  it("treats an insert as every field arriving from nothing", () => {
    const changes = diffAuditEntry({
      before_json: null,
      after_json: { status: "draft", total_minor: 0 },
    });
    expect(changes).toEqual([
      { field: "status", before: null, after: "draft" },
      { field: "total_minor", before: null, after: "0" },
    ]);
  });

  it("treats a delete as every field leaving", () => {
    expect(diffAuditEntry({ before_json: { memo: "typo" }, after_json: null })).toEqual([
      { field: "memo", before: "typo", after: null },
    ]);
  });

  it("does not confuse the number 0 with an empty value", () => {
    expect(
      diffAuditEntry({ before_json: { balance_due_minor: 8552 }, after_json: { balance_due_minor: 0 } }),
    ).toEqual([{ field: "balance_due_minor", before: "8552", after: "0" }]);
  });

  it("compares nested json by value, not by reference", () => {
    expect(
      diffAuditEntry({
        before_json: { meta: { source: "ui" } },
        after_json: { meta: { source: "ui" } },
      }),
    ).toEqual([]);
  });

  it("sorts fields so two runs over one entry read the same", () => {
    const changes = diffAuditEntry({
      before_json: { zeta: 1, alpha: 1 },
      after_json: { zeta: 2, alpha: 2 },
    });
    expect(changes.map((c) => c.field)).toEqual(["alpha", "zeta"]);
  });
});

describe("value formatting", () => {
  it("distinguishes a missing field from an empty one", () => {
    expect(formatAuditValue(null)).toBe("—");
    expect(formatAuditValue("")).toBe("(empty)");
    expect(formatAuditValue("draft")).toBe("draft");
  });

  it("names an actorless change after the system that made it", () => {
    expect(formatActor(null)).toBe("system");
    expect(formatActor("")).toBe("system");
    expect(formatActor("admin@ctyhp.vn")).toBe("admin@ctyhp.vn");
  });

  it("trims a stored timestamp to seconds", () => {
    expect(formatAuditTimestamp("2026-07-31T01:05:07.262484+00:00")).toBe("2026-07-31 01:05:07");
  });
});

describe("summarizeAuditChanges", () => {
  it("reads as field: before → after", () => {
    expect(summarizeAuditChanges(diffAuditEntry(ISSUE))).toBe(
      "invoice_number: (empty) → INV-000014; status: draft → issued",
    );
  });

  it("counts what it had to leave out", () => {
    const many = [
      { field: "a", before: "1", after: "2" },
      { field: "b", before: "1", after: "2" },
      { field: "c", before: "1", after: "2" },
      { field: "d", before: "1", after: "2" },
    ];
    expect(summarizeAuditChanges(many, 2)).toBe("a: 1 → 2; b: 1 → 2 (+2 more)");
  });

  it("says so when an entry moved no visible field", () => {
    expect(summarizeAuditChanges([])).toBe("No field changed");
  });
});

describe("documentAttribution", () => {
  const directory = new Map([
    ["ed318d58-2ef7-442c-b1af-9d3e20ed0b52", "admin@ctyhp.vn"],
    ["11111111-1111-1111-1111-111111111111", "intern1@ctyhp.vn"],
  ]);

  it("resolves both actors through the directory", () => {
    expect(
      documentAttribution(
        {
          created_at: "2026-07-30T09:00:00+00:00",
          created_by: "ed318d58-2ef7-442c-b1af-9d3e20ed0b52",
          updated_at: "2026-07-31T01:05:07+00:00",
          updated_by: "11111111-1111-1111-1111-111111111111",
        },
        directory,
      ),
    ).toEqual({
      createdBy: "admin@ctyhp.vn",
      createdAt: "2026-07-30T09:00:00+00:00",
      modifiedBy: "intern1@ctyhp.vn",
      modifiedAt: "2026-07-31T01:05:07+00:00",
    });
  });

  it("reports no modification on a record nobody has touched since creation", () => {
    const attribution = documentAttribution(
      {
        created_at: "2026-07-30T09:00:00+00:00",
        created_by: "ed318d58-2ef7-442c-b1af-9d3e20ed0b52",
        updated_at: "2026-07-30T09:00:00+00:00",
        updated_by: "ed318d58-2ef7-442c-b1af-9d3e20ed0b52",
      },
      directory,
    );
    expect(attribution.modifiedBy).toBeNull();
    expect(attribution.modifiedAt).toBeNull();
  });

  it("falls back to the raw id when the directory has no such user, and to system when there is none", () => {
    const attribution = documentAttribution(
      { created_at: "2026-07-30T09:00:00+00:00", created_by: "deleted-user-id", updated_at: null },
      directory,
    );
    expect(attribution.createdBy).toBe("deleted-user-id");
    expect(
      documentAttribution({ created_at: "2026-07-30T09:00:00+00:00", created_by: null }, directory)
        .createdBy,
    ).toBe("system");
  });
});

describe("audit trail report", () => {
  it("emits one row per changed field", () => {
    expect(auditTrailRows([ISSUE])).toEqual([
      {
        changed_at: "2026-07-31 01:05:07",
        changed_by: "admin@ctyhp.vn",
        table_name: "acc_invoice",
        record_id: "6c1252dc-7982-49d3-b864-b1e0b454a415",
        action: "post",
        field_changed: "invoice_number",
        old_value: "",
        new_value: "INV-000014",
      },
      {
        changed_at: "2026-07-31 01:05:07",
        changed_by: "admin@ctyhp.vn",
        table_name: "acc_invoice",
        record_id: "6c1252dc-7982-49d3-b864-b1e0b454a415",
        action: "post",
        field_changed: "status",
        old_value: "draft",
        new_value: "issued",
      },
    ]);
  });

  it("still reports an entry whose snapshots show no visible change", () => {
    const rows = auditTrailRows([
      { ...ISSUE, before_json: { status: "issued" }, after_json: { status: "issued" } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].field_changed).toBe("");
  });

  it("quotes a value containing a comma so it cannot shift a column", () => {
    const csv = auditTrailCsv([
      {
        ...ISSUE,
        action: "update",
        before_json: { memo: "Ring, 18k" },
        after_json: { memo: "Ring, 18k gold" },
      },
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "Changed at,Changed by,Table,Record id,Action,Field changed,Old value,New value",
    );
    expect(row).toContain('"Ring, 18k","Ring, 18k gold"');
  });
});

describe("auditTrailFileName", () => {
  it("names a whole calendar month after that month", () => {
    expect(auditTrailFileName({ from: "2026-07-01", to: "2026-07-31" })).toBe(
      "audit-trail-2026-07.csv",
    );
    expect(auditTrailFileName({ from: "2026-02-01", to: "2026-02-28" })).toBe(
      "audit-trail-2026-02.csv",
    );
  });

  it("keeps both ends for any other range", () => {
    expect(auditTrailFileName({ from: "2026-07-01", to: "2026-07-15" })).toBe(
      "audit-trail-2026-07-01_2026-07-15.csv",
    );
  });

  it("says so when the search was not bounded", () => {
    expect(auditTrailFileName({ from: null, to: null })).toBe("audit-trail-all.csv");
  });
});
