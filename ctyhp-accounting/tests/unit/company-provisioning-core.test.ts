import { describe, expect, it } from "vitest";
import {
  PROVISION_BATCH_SIZE,
  provisionCompany,
  type MigrationSource,
} from "@/lib/services/company-provisioning";
import { CHART_TEMPLATES } from "@/lib/domain/chart-templates";

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

/** The fake client, answering the template self-check with `rows`. */
function templateClient(rows: { account_code: string; parent_code: string | null }[]) {
  const client = fakeClient();
  return {
    sql: client.sql,
    async query(text: string, params?: unknown[]) {
      if (/as parent_code/.test(text)) {
        client.sql.push(text);
        return { rows };
      }
      return client.query(text, params);
    },
  };
}

const RETAIL = CHART_TEMPLATES.retail_jewelry.accounts;
const RETAIL_ROWS = RETAIL.map((a) => ({ account_code: a.code, parent_code: a.parent ?? null }));

describe("provisionCompany with a chart", () => {
  it("adds nothing to the Standard chart", async () => {
    const client = fakeClient();
    await provisionCompany(client, input, sources);
    expect(client.sql.some((s) => /insert into acc_account/i.test(s))).toBe(false);
  });

  it("writes the Retail & Jewelry chart after the migrations and before the company is registered", async () => {
    const client = templateClient(RETAIL_ROWS);
    await provisionCompany(client, { ...input, chartTemplate: "retail_jewelry" }, sources);

    expect(client.sql.filter((s) => /insert into acc_account/i.test(s))).toHaveLength(RETAIL.length);
    expect(client.sql.filter((s) => /set parent_account_id/i.test(s))).toHaveLength(RETAIL.filter((a) => a.parent).length);
    const order = client.sql.join("\n@@\n");
    expect(order.indexOf("create table acc_payment")).toBeLessThan(order.search(/insert into acc_account/i));
    expect(order.search(/set parent_account_id/i)).toBeLessThan(order.indexOf("insert into onebook.company"));
  });

  it("does not report success when an account is missing or under the wrong parent", async () => {
    const moved = RETAIL_ROWS.map((r) => (r.account_code === "1230" ? { ...r, parent_code: null } : r));
    await expect(
      provisionCompany(templateClient(moved), { ...input, chartTemplate: "retail_jewelry" }, sources),
    ).rejects.toThrow(/Retail & Jewelry chart — 1230/);

    const missing = RETAIL_ROWS.filter((r) => r.account_code !== "2500");
    await expect(
      provisionCompany(templateClient(missing), { ...input, chartTemplate: "retail_jewelry" }, sources),
    ).rejects.toThrow(/Retail & Jewelry chart — 2500/);
  });
});
