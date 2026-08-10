import pg from "pg";
import { redactQualityValue } from "./model.mjs";

const { Pool } = pg;

const SNAPSHOT_QUERY = `select
  queryid::text,
  calls::bigint,
  total_exec_time::double precision,
  mean_exec_time::double precision,
  query
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
order by total_exec_time desc
limit 500`;

function quotedStringEnd(query, start) {
  for (let index = start + 1; index < query.length; index += 1) {
    if (query[index] === "\\") {
      index += 1;
      continue;
    }
    if (query[index] !== "'") continue;
    if (query[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index + 1;
  }
  return query.length;
}

function quotedIdentifierEnd(query, start) {
  for (let index = start + 1; index < query.length; index += 1) {
    if (query[index] !== '"') continue;
    if (query[index + 1] === '"') {
      index += 1;
      continue;
    }
    return index + 1;
  }
  return query.length;
}

function dollarQuoteAt(query, start) {
  return query.slice(start).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] ?? "";
}

function blockCommentEnd(query, start) {
  let depth = 1;
  for (let index = start + 2; index < query.length; index += 1) {
    if (query.startsWith("/*", index)) {
      depth += 1;
      index += 1;
    } else if (query.startsWith("*/", index)) {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return query.length;
}

function tokenBoundary(query, index) {
  return index === 0 || !/[A-Za-z0-9_$]/.test(query[index - 1]);
}

export async function readQuerySnapshot(sql) {
  const result = await sql.query(SNAPSHOT_QUERY);
  return result.rows;
}

export function sanitizeNormalizedQuery(query) {
  const source = String(query ?? "");
  let output = "";

  for (let index = 0; index < source.length;) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      output += " ";
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      output += " ";
      index = blockCommentEnd(source, index);
      continue;
    }

    const prefixedQuote = /[EeBbXxNn]/.test(source[index] ?? "")
      && source[index + 1] === "'"
      && tokenBoundary(source, index);
    if (source[index] === "'" || prefixedQuote) {
      const quoteStart = prefixedQuote ? index + 1 : index;
      output += "?";
      index = quotedStringEnd(source, quoteStart);
      continue;
    }

    if (source[index] === '"') {
      const end = quotedIdentifierEnd(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    if (source[index] === "$") {
      const tag = dollarQuoteAt(source, index);
      if (tag) {
        const end = source.indexOf(tag, index + tag.length);
        output += "?";
        index = end === -1 ? source.length : end + tag.length;
        continue;
      }
    }

    const numeric = source.slice(index).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numeric && tokenBoundary(source, index)) {
      output += "?";
      index += numeric[0].length;
      continue;
    }

    const keywordLiteral = source.slice(index).match(/^(?:null|true|false)\b/i);
    if (keywordLiteral && tokenBoundary(source, index)) {
      output += "?";
      index += keywordLiteral[0].length;
      continue;
    }

    output += source[index];
    index += 1;
  }

  return output.replace(/\s+/g, " ").trim();
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function queryTimingDelta(before, after) {
  const previous = new Map((before ?? []).map((row) => [String(row.queryid), row]));
  return (after ?? []).map((row) => {
    const prior = previous.get(String(row.queryid));
    return {
      queryid: String(row.queryid),
      calls: Math.max(0, finiteNonNegative(row.calls) - finiteNonNegative(prior?.calls)),
      totalExecMs: Math.max(
        0,
        finiteNonNegative(row.total_exec_time) - finiteNonNegative(prior?.total_exec_time),
      ),
      meanExecMs: finiteNonNegative(row.mean_exec_time),
      query: sanitizeNormalizedQuery(row.query),
    };
  });
}

function querySection(extra = {}) {
  return { findings: [], measurements: [], unavailable: [], safetyFailures: [], ...extra };
}

function unavailableQuerySection(reason, error) {
  const safeError = error
    ? redactQualityValue({
        class: error?.constructor?.name || "Error",
        message: String(error?.message ?? error),
      })
    : undefined;
  const unavailable = { kind: "query", reason, ...(safeError ? { error: safeError } : {}) };
  return querySection({
    available: false,
    reason,
    ...(safeError ? { error: safeError } : {}),
    unavailable: [unavailable],
  });
}

function availableQuerySection(before, after) {
  const queries = queryTimingDelta(before, after);
  return querySection({
    available: true,
    queries,
    measurements: queries.map((query) => ({
      key: `query.${query.queryid}.meanExecMs`,
      kind: "query",
      value: query.meanExecMs,
    })),
  });
}

export async function startQueryTiming(env = process.env, poolFactory = (config) => new Pool(config)) {
  const databaseUrl = String(env.QUALITY_DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    const artifact = unavailableQuerySection("QUALITY_DATABASE_URL is not configured");
    return { async finish() { return artifact; } };
  }

  let pool;
  try {
    pool = poolFactory({
      connectionString: databaseUrl,
      application_name: "onebook-quality-readonly",
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
  } catch (error) {
    const artifact = unavailableQuerySection("Query timing is unavailable", error);
    return { async finish() { return artifact; } };
  }

  let before;
  let startError;
  try {
    before = await readQuerySnapshot(pool);
  } catch (error) {
    startError = error;
  }

  return {
    async finish() {
      let artifact;
      try {
        if (startError) {
          artifact = unavailableQuerySection("Query timing is unavailable", startError);
        } else {
          artifact = availableQuerySection(before, await readQuerySnapshot(pool));
        }
      } catch (error) {
        artifact = unavailableQuerySection("Query timing is unavailable", error);
      } finally {
        try {
          await pool.end();
        } catch (error) {
          artifact = unavailableQuerySection("Query timing is unavailable", error);
        }
      }
      return artifact;
    },
  };
}
