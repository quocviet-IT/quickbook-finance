/**
 * Behavioural verification that a settings guard turns the wrong person away.
 *
 * `smoke-pages` signs in as an administrator, so it only ever proves the doors
 * OPEN. This proves they CLOSE, which is the half a permission change is
 * actually about. It signs in as a real non-administrator the same way -- a
 * one-time link minted with the service role -- and issues GETs. It writes
 * nothing, so it is safe against a database holding real books.
 *
 * Run against the BUILT server (`npm start`), never `npm run dev`:
 *   node --env-file=.env.local scripts/verify-settings-guard.mjs http://localhost:3000
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const role = process.env.GUARD_ROLE?.trim() || "viewer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- Who to be -------------------------------------------------------------
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const { rows } = await db.query(
  `select u.email
     from acc_app_user a
     join auth.users u on u.id = a.id
    where a.role = $1 and a.status = 'active'
    order by a.created_at
    limit 1`,
  [role],
);
await db.end();

const email = rows[0]?.email;
if (!email) {
  console.error(`No active ${role} to sign in as.`);
  process.exit(1);
}
console.log(`Signing in as the first active ${role}: ${email}\n`);

// --- Become them ------------------------------------------------------------
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
if (linkError) throw new Error(`sign-in link failed: ${linkError.message}`);
const { data: signedIn, error: otpError } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
if (otpError) throw new Error(`sign-in failed: ${otpError.message}`);

/** The cookie @supabase/ssr reads, chunked the way it chunks it. */
function sessionCookie(session, user) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const encoded =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: "bearer",
        user,
      }),
      "utf8",
    ).toString("base64");
  const name = `sb-${ref}-auth-token`;
  const CHUNK = 3180;
  if (encoded.length <= CHUNK) return `${name}=${encoded}`;
  const parts = [];
  for (let i = 0; i * CHUNK < encoded.length; i++) {
    parts.push(`${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return parts.join("; ");
}

const cookie = sessionCookie(signedIn.session, signedIn.user);
const get = (route) => fetch(base + route, { headers: { cookie }, redirect: "manual" });

/**
 * How a refusal actually reaches the browser.
 *
 * The app shell is an async layout, so by the time a page calls redirect() the
 * response has already begun streaming and Next can no longer set a status. It
 * falls back to a meta refresh and a 200. A redirect from the layout itself --
 * an unauthenticated request -- still gets a clean 307, which is how we know
 * this is the streaming fallback and not a broken guard.
 *
 * Either mechanism is a refusal. What matters is that the page's own body was
 * never rendered, so accept both and check the body separately.
 */
async function refusal(route) {
  const res = await get(route);
  const target = `/settings?denied=${encodeURIComponent(route)}`;
  const location = res.headers.get("location") ?? "";
  if (res.status === 307 && location.includes(target)) {
    return { refused: true, how: "307", body: "" };
  }
  const body = res.status === 200 ? await res.text() : "";
  const meta = body.includes(`__next-page-redirect`) && body.includes(`url=${target}`);
  return { refused: meta, how: meta ? "meta refresh" : `HTTP ${res.status}`, body };
}

/**
 * What each role may open, taken from the catalog's own gates.
 *
 * Import is `roles: ["admin", "accountant"]` because that is what `canWrite` in
 * its actions enforces; audit is `audit.read`, which an accountant and a viewer
 * both hold. Everything else on this list is administrator work. A role that
 * opens something not listed here is the failure this file exists to catch.
 */
const ALLOWED = {
  viewer: ["/settings/audit"],
  accountant: ["/settings/audit", "/settings/import"],
  sales: [],
};
const GATED = [
  "/settings/users",
  "/settings/permissions",
  "/settings/companies",
  "/settings/company",
  "/settings/approvals",
  "/settings/import",
  "/settings/purchasing",
  "/settings/periods",
  "/settings/audit",
];
const allowed = ALLOWED[role] ?? [];

// --- The doors that must be shut -------------------------------------------
console.log(`== what a ${role} is turned away from`);
for (const route of GATED.filter((r) => !allowed.includes(r))) {
  const { refused, how } = await refusal(route);
  check(`${route} is refused and sent to the hub, named`, refused, how);
}

console.log(`\n== what a ${role} may still open`);
for (const route of allowed) {
  const res = await get(route);
  check(`${route} opens`, res.status === 200, `HTTP ${res.status}`);
}

// A refusal that still rendered the screen would be no refusal at all.
console.log("\n== the refused screen's own content never reaches the browser");
{
  const { body } = await refusal("/settings/users");
  check("no Users page header", !body.includes("Create login accounts"));
  check("no user table", !body.includes("MFA"));
  const emails = [...new Set(body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])].filter(
    (found) => found.toLowerCase() !== email.toLowerCase(),
  );
  check("nobody else's email address", emails.length === 0, emails.join(", "));
}
{
  const { body } = await refusal("/settings/permissions");
  check("no permission matrix", !body.includes("What each role may do"));
  check("no permission key rows", !body.includes("users.manage"));
}

// --- The doors that must stay open ------------------------------------------
console.log("\n== the feedback route, which is deliberately unguarded");
{
  const res = await get("/settings/feedback");
  const body = res.status === 200 ? await res.text() : "";
  check("the feedback route is not guarded", res.status === 200, `HTTP ${res.status}`);
  check("it renders as My reports, not the triage queue", body.includes("My reports"));
  check("it does not offer the triage wording", !body.includes("Feedback triage"));
}

// --- The hub shows only what it should --------------------------------------
console.log("\n== the hub itself");
{
  const res = await get("/settings");
  const body = res.status === 200 ? await res.text() : "";
  check("the hub renders", res.status === 200, `HTTP ${res.status}`);
  check("no Users card", !body.includes("Create login accounts"));
  check("no Permissions card", !body.includes("What each role may do"));
  // A card is present exactly when the door behind it opens — that equivalence
  // is the whole point of reading both from one catalog entry.
  check(
    `the audit card is ${allowed.includes("/settings/audit") ? "there" : "absent"}`,
    body.includes("Who changed what") === allowed.includes("/settings/audit"),
  );
  check(
    `the import card is ${allowed.includes("/settings/import") ? "there" : "absent"}`,
    body.includes("Bring a chart of accounts") === allowed.includes("/settings/import"),
  );
  // Everyone gets this one, whatever their role: it is the fallback wording.
  check("the reporter's card is there", body.includes("The bug reports and suggestions you filed"));
}
{
  const res = await get(`/settings?denied=${encodeURIComponent("/settings/users")}`);
  const body = res.status === 200 ? await res.text() : "";
  check("a denied redirect explains itself by name", body.includes("Users is not available to your role"));
}

// --- A revoked account is revoked here too ----------------------------------
/**
 * The product tells whoever suspends someone that it "revokes read and write
 * access immediately across the whole application". The database agrees:
 * acc_current_role() (0037) answers only for status in ('invited','active').
 * currentAccess() has to answer the same way, or a suspended administrator
 * keeps every screen gated on `roles` alone.
 *
 * Proven against an account that is already not active, so this writes nothing.
 */
const revoked = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await revoked.connect();
const { rows: inactive } = await revoked.query(
  `select u.email, a.role, a.status
     from acc_app_user a join auth.users u on u.id = a.id
    where a.status not in ('invited', 'active')
    order by a.status_changed_at nulls last
    limit 1`,
);
await revoked.end();

console.log("\n== an account that is no longer active");
if (!inactive[0]) {
  console.log("  SKIPPED — no suspended or offboarded account exists to test with");
} else {
  const { email: goneEmail, role: goneRole, status } = inactive[0];
  console.log(`  signed out of the business: ${goneEmail} (${goneRole}, ${status})`);
  const { data: goneLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: goneEmail,
  });
  const { data: goneSession, error: goneError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: goneLink.properties.hashed_token,
  });
  if (goneError) {
    check("their session can still be minted (so the guard is what must stop them)", false, goneError.message);
  } else {
    const goneCookie = sessionCookie(goneSession.session, goneSession.user);
    for (const route of ["/settings/import", "/settings/periods", "/settings/companies", "/settings/audit"]) {
      const res = await fetch(base + route, { headers: { cookie: goneCookie }, redirect: "manual" });
      const target = `/settings?denied=${encodeURIComponent(route)}`;
      const location = res.headers.get("location") ?? "";
      let refused = res.status === 307 && location.includes(target);
      if (!refused && res.status === 200) {
        const b = await res.text();
        refused = b.includes("__next-page-redirect") && b.includes(`url=${target}`);
      }
      // /settings/import is gated on roles: ["admin","accountant"]. Before the
      // status filter went into currentAccess(), this exact request opened it.
      check(`${route} is refused`, refused, `HTTP ${res.status} ${location}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
