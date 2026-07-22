// Diagnose DB connectivity from this machine across all Supabase endpoints.
// Prints, for each: DNS (IPv4/IPv6), and connect result with the real error.
// Run: node --env-file=.env.local scripts/diagnose-db.mjs
import pg from "pg";
import dns from "node:dns/promises";

const raw = process.env.SUPABASE_DB_URL;
if (!raw) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }

const base = new URL(raw);
const ref = base.username.includes(".") ? base.username.split(".")[1] : "zejowvuukuilzettkeoq";
const password = decodeURIComponent(base.password);

function build({ host, port, user }) {
  const u = new URL(raw);
  u.hostname = host; u.port = String(port); u.username = user;
  return u.toString();
}

const targets = [
  { label: "shared session  ", host: base.hostname, port: 5432, user: base.username },
  { label: "shared txn 6543 ", host: base.hostname, port: 6543, user: base.username },
  { label: "dedicated 6543  ", host: `db.${ref}.supabase.co`, port: 6543, user: "postgres" },
  { label: "direct 5432     ", host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
];

async function resolve(host) {
  const out = [];
  try { const a = await dns.resolve4(host); out.push(`IPv4:${a.slice(0, 2).join(",")}`); } catch { out.push("IPv4:none"); }
  try { const a = await dns.resolve6(host); out.push(`IPv6:${a.slice(0, 1).join(",")}`); } catch { out.push("IPv6:none"); }
  return out.join(" ");
}

async function tryConn(t) {
  const dnsInfo = await resolve(t.host);
  const url = build(t);
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 12000 });
  const started = Date.now();
  try {
    await c.connect();
    const r = await c.query("select 1 as x");
    console.log(`  ${t.label} OK    ${t.host}:${t.port}  [${dnsInfo}]  ${Date.now() - started}ms`);
    await c.end();
  } catch (e) {
    const inner = (e.errors || []).map((x) => `${x.code || x.name}`).join(",");
    console.log(`  ${t.label} FAIL  ${t.host}:${t.port}  [${dnsInfo}]  ${e.name}/${e.code ?? "-"} ${e.message || ""}${inner ? ` (${inner})` : ""}`);
    try { await c.end(); } catch { /* ignore */ }
  }
}

console.log(`DB diagnosis (password length ${password.length}):`);
for (const t of targets) await tryConn(t); // sequential for readable output
process.exit(0);
