/**
 * Read-only check that the built /payments screen really ships the void controls.
 *
 * The page smoke sweep proves the route returns 200. This goes one step further
 * for the feature that was just added: it signs in the same way, loads the page,
 * and then follows the script tags the page actually asks the browser for — the
 * payments table is a client component, so its markup exists in that JavaScript
 * rather than in the server HTML. It writes nothing and clicks nothing; the last
 * confirmation on a real void is a human's to give.
 *
 * Run (built server must be up):
 *   node --env-file=.env.local scripts/smoke-payments-void.mjs [baseUrl]
 */
import { smokeSession } from "./smoke-environment.mjs";

const base = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3000";

function sessionCookie(session, user, supabaseUrl) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user,
  };
  const encoded = "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const name = `sb-${ref}-auth-token`;
  const CHUNK = 3180;
  if (encoded.length <= CHUNK) return `${name}=${encoded}`;
  const parts = [];
  for (let i = 0; i * CHUNK < encoded.length; i++) {
    parts.push(`${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return parts.join("; ");
}

let failed = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const { session, user, supabaseUrl } = await smokeSession();
const cookie = sessionCookie(session, user, supabaseUrl);

const res = await fetch(`${base}/payments`, { headers: { cookie }, redirect: "manual" });
const html = await res.text();
console.log(`GET ${base}/payments → ${res.status}`);
check("the page rendered", res.status === 200 && !html.includes("We could not load this page"));
check("the page header is server-rendered", html.includes("Payments"));

// Whatever the page asks the browser to load is what the user will run.
const scripts = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[\w.\-/]+\.js/g)].map((m) => m[0]))];
check("the page ships client chunks", scripts.length > 0, `${scripts.length} found`);

const bundles = await Promise.all(
  scripts.map(async (path) => {
    const chunk = await fetch(base + path);
    return chunk.ok ? chunk.text() : "";
  }),
);
const shipped = bundles.join("\n");

check("Void payment is offered on screen", shipped.includes("Void payment"));
check("Create replacement is offered for a void row", shipped.includes("Create replacement"));
check("the void modal explains the consequence", shipped.includes("What voiding does"));
check("a reason is required before confirming", shipped.includes("Explain why this payment is being voided"));
check("replacement mode has its own title", shipped.includes("Create replacement payment"));
check("the receipt flow is untouched", shipped.includes("Receive payment"));
check("attribution is shown, not just stored", shipped.includes("Voided by "));
check("nothing offers to revive a void payment", !/unvoid|reinstate/i.test(shipped));
check("the detail view is offered", shipped.includes("Invoices settled"));
check("the description edit is offered", shipped.includes("Edit details"));
check("the one-step correction is offered", shipped.includes("Correct payment"));

console.log(`\n${failed} failed`);
if (failed > 0) process.exit(1);
