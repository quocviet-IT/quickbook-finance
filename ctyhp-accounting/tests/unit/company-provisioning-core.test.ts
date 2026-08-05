import { describe, expect, it } from "vitest";
import {
  PROVISION_BATCH_SIZE,
  provisionCompany,
  type MigrationSource,
} from "@/lib/services/company-provisioning";

/** A Postgres client that records what it was asked and answers plausibly. */
function fakeClient(overrides: { failOn?: RegExp } = {}) {
  const sql: string[] = [];
  return {
    sql,
    async query(text: string, params?: unknown[]) {
      sql.push(text);
      if (overrides.failOn?.test(text)) throw new Error("syntax error at or near");
      if (/information_schema\.tables/.test(text)) {
        return { rows: [{ table_name: "acc_invoice" }, { table_name: "acc_payment" }] };
      }
      if (/pg_proc/.test(text)) return { rows: [{ proname: "acc_post_entry" }] };
      if (/pg_policies/.test(text)) return { rows: [{ n: 42 }] };
      if (/insert into onebook\.company\b/.test(text)) return { rows: [{ id: "company-1" }] };
      if (/string_agg/.test(text)) return { rows: [{ schemas: "co_probe, onebook, public" }] };
      void params;
      return { rows: [] };
    },
  };
}

const sources: MigrationSource[] = [
  { file: "0001_init.sql", sql: "create table acc_invoice (id uuid primary key);" },
  { file: "0002_more.sql", sql: "create table acc_payment (id uuid primary key);" },
];

const input = {
  slug: "north_star",
  legalName: "North Star Bridal LLC",
  isSample: false,
  displayOrder: 100,
  adminUserIds: [] as string[],
};

describe("provisionCompany", () => {
  it("builds the schema before anything is allowed to use it", async () => {
    const client = fakeClient();

    await provisionCompany(client, input, sources);

    const order = client.sql.join("\n@@\n");
    const at = (needle: string) => order.indexOf(needle);
    expect(at("create schema co_north_star")).toBeGreaterThan(-1);
    expect(at("create schema co_north_star")).toBeLessThan(at("acc_schema_migrations"));
    expect(at("acc_schema_migrations")).toBeLessThan(at("set local search_path = co_north_star"));
    expect(at("set local search_path = co_north_star")).toBeLessThan(at("grant usage on schema"));
    expect(at("grant usage on schema")).toBeLessThan(at("insert into onebook.company"));
    expect(at("revoke all on schema co_north_star from anon")).toBeGreaterThan(-1);
  });

  it("tells PostgREST about the new schema, and reloads both caches", async () => {
    const client = fakeClient();

    await provisionCompany(client, input, sources);

    const order = client.sql.join("\n@@\n");
    expect(order).toContain("alter role authenticator set pgrst.db_schemas");
    expect(order).toContain("reload config");
    expect(order).toContain("reload schema");
  });

  it("sends statements in batches rather than one round trip each", async () => {
    const many: MigrationSource[] = [
      {
        file: "0003_many.sql",
        sql: Array.from(
          { length: PROVISION_BATCH_SIZE * 2 },
          (_, i) => `create table t${i} (id int);`,
        ).join("\n"),
      },
    ];
    const client = fakeClient();

    await provisionCompany(client, input, many);

    const batches = client.sql.filter((text) => text.startsWith("create table t"));
    expect(batches.length).toBe(2);
    expect(batches[0].split(";").length).toBeGreaterThan(2);
  });

  it("replays a failing batch one statement at a time so the error names it", async () => {
    const many: MigrationSource[] = [
      {
        file: "0003_many.sql",
        sql: [
          "create table good_a (id int);",
          "create tabel typo (id int);",
          "create table good_b (id int);",
        ].join("\n"),
      },
    ];
    const client = fakeClient({ failOn: /create tabel typo/ });

    await expect(provisionCompany(client, input, many)).rejects.toThrow(/create tabel typo/);
  });

  it("refuses to report success when the new schema is missing something public has", async () => {
    let tablesAsked = 0;
    const client = {
      async query(text: string) {
        if (/information_schema\.tables/.test(text)) {
          tablesAsked += 1;
          // The company is asked first, public second — and public has more.
          return tablesAsked === 1
            ? { rows: [{ table_name: "acc_invoice" }] }
            : { rows: [{ table_name: "acc_invoice" }, { table_name: "acc_journal_entry" }] };
        }
        if (/pg_proc/.test(text)) return { rows: [] };
        if (/pg_policies/.test(text)) return { rows: [{ n: 0 }] };
        if (/insert into onebook\.company\b/.test(text)) return { rows: [{ id: "company-1" }] };
        if (/string_agg/.test(text)) return { rows: [{ schemas: "public" }] };
        return { rows: [] };
      },
    };

    await expect(provisionCompany(client, input, sources)).rejects.toThrow(/acc_journal_entry/);
  });
});
