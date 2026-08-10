import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  queryTimingDelta,
  readQuerySnapshot,
  sanitizeNormalizedQuery,
  startQueryTiming,
} from "../../scripts/quality/query-timing.mjs";

function eventPool(methods: {
  query: (statement: string) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
}) {
  return Object.assign(new EventEmitter(), methods);
}

const startQueryTimingWithTestPool = startQueryTiming as unknown as (
  env: NodeJS.ProcessEnv,
  poolFactory: (config: unknown) => ReturnType<typeof eventPool>,
) => ReturnType<typeof startQueryTiming>;

function testEnvironment(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("quality query timing", () => {
  it("runs the one approved read-only pg_stat_statements query", async () => {
    const statements: string[] = [];
    const rows = [{
      queryid: "1",
      calls: "10",
      total_exec_time: 100,
      mean_exec_time: 10,
      query: "select * from acc_invoice where id = $1",
    }];
    const sql = {
      async query(statement: string) {
        statements.push(statement);
        return { rows };
      },
    };

    await expect(readQuerySnapshot(sql)).resolves.toBe(rows);
    expect(statements).toEqual([`select
  queryid::text,
  calls::bigint,
  total_exec_time::double precision,
  mean_exec_time::double precision,
  query
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
order by total_exec_time desc
limit 500`]);
  });

  it("computes non-negative deltas without resetting shared stats", () => {
    const before = [{
      queryid: "1",
      calls: "10",
      total_exec_time: 100,
      mean_exec_time: 10,
      query: "select * from acc_invoice where id = $1",
    }];
    const after = [{
      queryid: "1",
      calls: "13",
      total_exec_time: 145,
      mean_exec_time: 15,
      query: "select * from acc_invoice where id = $1",
    }];

    expect(queryTimingDelta(before, after)).toEqual([{
      queryid: "1",
      calls: 3,
      totalExecMs: 45,
      meanExecMs: 15,
      query: "select * from acc_invoice where id = $1",
    }]);
  });

  it("clamps reset counters and includes newly observed queries", () => {
    const before = [{
      queryid: "1",
      calls: 10,
      total_exec_time: 100,
      mean_exec_time: 10,
      query: "select old",
    }];
    const after = [
      {
        queryid: "1",
        calls: 2,
        total_exec_time: 20,
        mean_exec_time: 10,
        query: "select old",
      },
      {
        queryid: "2",
        calls: 4,
        total_exec_time: 24,
        mean_exec_time: 6,
        query: "select new where amount = 42",
      },
    ];

    expect(queryTimingDelta(before, after)).toEqual([
      {
        queryid: "1",
        calls: 0,
        totalExecMs: 0,
        meanExecMs: 10,
        query: "select old",
      },
      {
        queryid: "2",
        calls: 4,
        totalExecMs: 24,
        meanExecMs: 6,
        query: "select new where amount = ?",
      },
    ]);
  });

  it("keeps normalized SQL shape while removing comments and literals", () => {
    expect(sanitizeNormalizedQuery("select * from acc_invoice where memo = 'customer secret' -- note"))
      .toBe("select * from acc_invoice where memo = ?");
    expect(sanitizeNormalizedQuery(`select "Account Name", $1
      from acc_invoice /* private note */
      where amount in (42, -3.5) and memo = $$customer secret$$`))
      .toBe('select "Account Name", $1 from acc_invoice where amount in (?, ?) and memo = ?');
    expect(sanitizeNormalizedQuery("select '--not a comment' as memo, E'private\\'value' as detail"))
      .toBe("select ? as memo, ? as detail");
    expect(sanitizeNormalizedQuery("select /* outer /* customer secret */ private note */ 1"))
      .toBe("select ?");
  });

  it("removes PostgreSQL base-prefixed and underscore-separated numeric literals", () => {
    expect(sanitizeNormalizedQuery("select 0xDEADBEEF")).toBe("select ?");
    expect(sanitizeNormalizedQuery("select 1_234_567")).toBe("select ?");
    expect(sanitizeNormalizedQuery("select 0xDEAD_BEEF, 0o755, 0b1010_0110"))
      .toBe("select ?, ?, ?");
    expect(sanitizeNormalizedQuery("select 1_234.5_6e+7_8"))
      .toBe("select ?");
  });

  it("stays unavailable without the explicit quality database variable", async () => {
    let poolCreated = false;
    const sampler = await startQueryTimingWithTestPool(testEnvironment({
      DATABASE_URL: "postgresql://application.example/private",
      SUPABASE_DB_URL: "postgresql://supabase.example/private",
      E2E_DATABASE_URL: "postgresql://e2e.example/private",
    }), () => {
      poolCreated = true;
      throw new Error("must not create a pool");
    });

    expect(await sampler.finish()).toMatchObject({
      available: false,
      reason: "QUALITY_DATABASE_URL is not configured",
      findings: [],
      measurements: [],
      unavailable: [{ kind: "query", reason: "QUALITY_DATABASE_URL is not configured" }],
      safetyFailures: [],
    });
    expect(poolCreated).toBe(false);
  });

  it("uses the bounded read-only pool and emits advisory query measurements", async () => {
    const configurations: unknown[] = [];
    const statements: string[] = [];
    let closed = 0;
    const snapshots = [
      [{ queryid: "7", calls: "4", total_exec_time: 20, mean_exec_time: 5, query: "select memo from acc_invoice where id = $1" }],
      [{ queryid: "7", calls: "6", total_exec_time: 36, mean_exec_time: 6, query: "select memo from acc_invoice where id = $1 -- internal" }],
    ];
    const sampler = await startQueryTimingWithTestPool(testEnvironment({ QUALITY_DATABASE_URL: "postgresql://qa-only" }), (config) => {
      configurations.push(config);
      return eventPool({
        async query(statement: string) {
          statements.push(statement);
          return { rows: snapshots.shift() ?? [] };
        },
        async end() { closed += 1; },
      });
    });

    const artifact = await sampler.finish();

    expect(configurations).toEqual([{
      connectionString: "postgresql://qa-only",
      application_name: "onebook-quality-readonly",
      max: 1,
      connectionTimeoutMillis: 5_000,
    }]);
    expect(statements).toHaveLength(2);
    expect(new Set(statements)).toHaveLength(1);
    expect(closed).toBe(1);
    expect(artifact).toMatchObject({
      available: true,
      queries: [{
        queryid: "7",
        calls: 2,
        totalExecMs: 16,
        meanExecMs: 6,
        query: "select memo from acc_invoice where id = $1",
      }],
      measurements: [{ key: "query.7.meanExecMs", kind: "query", value: 6 }],
      unavailable: [],
      safetyFailures: [],
    });
  });

  it("redacts database failures, closes the pool, and remains non-blocking", async () => {
    let reads = 0;
    let closed = 0;
    const sampler = await startQueryTimingWithTestPool(testEnvironment({ QUALITY_DATABASE_URL: "postgresql://qa-only" }), () => eventPool({
      async query() {
        reads += 1;
        throw new TypeError("relation missing at postgresql://user:secret@db/name password=hunter2");
      },
      async end() { closed += 1; },
    }));

    const artifact = await sampler.finish();
    const serialized = JSON.stringify(artifact);

    expect(artifact).toMatchObject({
      available: false,
      reason: "Query timing is unavailable",
      error: { class: "TypeError", message: expect.any(String) },
      findings: [],
      measurements: [],
      safetyFailures: [],
    });
    expect(artifact.unavailable).toHaveLength(1);
    expect(reads).toBe(1);
    expect(closed).toBe(1);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("postgresql://");
  });

  it("turns a failed after-snapshot into an unavailable artifact and still closes", async () => {
    let reads = 0;
    let closed = 0;
    const sampler = await startQueryTimingWithTestPool(testEnvironment({ QUALITY_DATABASE_URL: "postgresql://qa-only" }), () => eventPool({
      async query() {
        reads += 1;
        if (reads === 2) throw new Error("pg_stat_statements disappeared");
        return { rows: [] };
      },
      async end() { closed += 1; },
    }));

    await expect(sampler.finish()).resolves.toMatchObject({
      available: false,
      reason: "Query timing is unavailable",
      error: { class: "Error", message: "pg_stat_statements disappeared" },
    });
    expect(reads).toBe(2);
    expect(closed).toBe(1);
  });

  it("turns a close failure into an unavailable artifact", async () => {
    const sampler = await startQueryTimingWithTestPool(testEnvironment({ QUALITY_DATABASE_URL: "postgresql://qa-only" }), () => eventPool({
      async query() { return { rows: [] }; },
      async end() { throw new Error("close failed password=hunter2"); },
    }));

    const artifact = await sampler.finish();
    expect(artifact).toMatchObject({
      available: false,
      reason: "Query timing is unavailable",
      error: { class: "Error", message: "close failed password=[redacted]" },
    });
    expect(JSON.stringify(artifact)).not.toContain("hunter2");
  });

  it("captures idle pool errors before the first snapshot and closes exactly once", async () => {
    const listenerCountsAtQuery: number[] = [];
    let reads = 0;
    let closed = 0;
    const pool = eventPool({
      async query() {
        reads += 1;
        listenerCountsAtQuery.push(pool.listenerCount("error"));
        return { rows: [] };
      },
      async end() { closed += 1; },
    });
    const sampler = await startQueryTimingWithTestPool(
      testEnvironment({ QUALITY_DATABASE_URL: "postgresql://qa-only" }),
      () => pool,
    );

    let emittedError;
    try {
      pool.emit("error", new Error("idle failure at postgresql://user:secret@db/name password=hunter2"));
    } catch (error) {
      emittedError = error;
    }
    const artifact = await sampler.finish();
    const serialized = JSON.stringify(artifact);

    expect(emittedError).toBeUndefined();
    expect(listenerCountsAtQuery).toEqual([1]);
    expect(reads).toBe(1);
    expect(closed).toBe(1);
    expect(pool.listenerCount("error")).toBe(0);
    expect(artifact).toMatchObject({
      available: false,
      reason: "Query timing is unavailable",
      error: { class: "Error", message: expect.any(String) },
    });
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("postgresql://");
  });

  it("writes the unavailable query artifact while the remaining runtime finishes", () => {
    const root = mkdtempSync(join(tmpdir(), "onebook-query-unavailable-"));
    const script = join(process.cwd(), "scripts", "quality", "run-runtime.mjs");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      QUALITY_ONLY: "keyboard",
      QUALITY_MODE: "report",
      SMOKE_EMAIL: "",
      SMOKE_PASSWORD: "",
      DATABASE_URL: "postgresql://127.0.0.1:1/application",
      SUPABASE_DB_URL: "postgresql://127.0.0.1:1/supabase",
      E2E_DATABASE_URL: "postgresql://127.0.0.1:1/e2e",
    };
    delete env.QUALITY_DATABASE_URL;

    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    const queries = JSON.parse(readFileSync(join(root, ".quality-results", "queries.json"), "utf8"));
    const summary = JSON.parse(readFileSync(join(root, ".quality-results", "summary.json"), "utf8"));

    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(queries).toMatchObject({
      available: false,
      reason: "QUALITY_DATABASE_URL is not configured",
      findings: [],
      measurements: [],
      unavailable: [{ kind: "query", reason: "QUALITY_DATABASE_URL is not configured" }],
      safetyFailures: [],
    });
    expect(summary.unavailable).toContainEqual({
      kind: "query",
      reason: "QUALITY_DATABASE_URL is not configured",
    });
  });
});
