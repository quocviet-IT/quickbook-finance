// Diagnose DB connectivity from this machine. Tries the configured endpoint and
// the transaction-pooler port, printing the real error for each.
// Run: node --env-file=.env.local scripts/diagnose-db.mjs
import pg from "pg";

const raw = process.env.SUPABASE_DB_URL;
if (!raw) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }

function describe(u) {
  try { const x = new URL(u); return `${x.hostname}:${x.port} (user ${x.username})`; }
  catch { return "(unparseable url)"; }
}

async function tryConn(label, url) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  const t = Date.now();
  try {
    await c.connect();
    const r = await c.query("select 1 as x");
    console.log(`  ${label}  OK (${describe(url)})  select=${r.rows[0].x}  in ${Date.now() - t}ms`);
    await c.end();
    return true;
  } catch (e) {
    const inner = (e.errors || []).map((x) => `${x.code || x.name} ${x.address || ""}:${x.port || ""}`).join(", ");
    console.log(`  ${label}  FAIL (${describe(url)})  name=${e.name} code=${e.code ?? "-"} msg="${e.message || "-"}"${inner ? `  inner=[${inner}]` : ""}`);
    try { await c.end(); } catch { /* ignore */ }
    return false;
  }
}

console.log("DB connectivity diagnosis:");
await tryConn("configured", raw);
await tryConn("port-6543 ", raw.replace(":5432/", ":6543/"));
process.exit(0);
