// scripts/smoke-pages.mjs
// Request every authenticated page against a running server and fail on any that
// does not return 200 or that renders the error boundary.
//
// This catches a class of bug the other gates cannot: `npm run build`,
// `typecheck`, and `lint` all passed while /settings threw at render time,
// because a Server Component read a compound Ant Design sub-component
// (Typography.Title) off a client-reference proxy. tests/unit/rsc-antd.test.ts
// now guards that specific rule; this script is the broader net for anything
// else that only fails when a page actually renders.
//
// Routes are discovered from app/(app), so a new page is covered automatically.
// Dynamic segments are skipped — they need a real record id.
//
// Run (dev or preview server must already be up):
//   node --env-file=.env.local scripts/smoke-pages.mjs [baseUrl] [extra routes...]
//
// Run it against a built server (`npm run build && npm start`), not `npm run
// dev`: a dev server compiles each route on its first request, which turns a
// two-minute sweep into half an hour.
//
// Flags:
//   --only=/a,/b     check just these routes (after a change to one screen)
//   --concurrency=N  requests in flight at once; default 6, use 1 against dev
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "app", "(app)");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SMOKE_EMAIL ?? "admin@ctyhp.vn";
const password = process.env.SMOKE_PASSWORD ?? "Ctyhp@Ketoan2026";

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const extraRoutes = args.filter((a) => a.startsWith("/"));
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
// A leading slash is optional: Git Bash rewrites `/invoices` into a Windows
// path before the script ever sees it, so `--only=invoices,sales-tax` is the
// form that works everywhere.
const onlyRoutes = (flag("only") ?? "")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean)
  .map((route) => (route.startsWith("/") ? route : `/${route}`));
const concurrency = Math.max(1, Number(flag("concurrency") ?? 6));

/** Every static route under app/(app). */
function discoverRoutes(dir = appDir, prefix = "") {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("[")) continue; // needs a real id
      routes.push(...discoverRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx" && prefix !== "") {
      routes.push(prefix);
    }
  }
  return routes;
}

/**
 * Build the session cookie the way @supabase/ssr reads it: base64-prefixed JSON,
 * split into numbered chunks past the cookie size limit.
 */
function sessionCookie(session, user) {
  const ref = new URL(url).hostname.split(".")[0];
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

async function main() {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error("login: " + error.message);
  const cookie = sessionCookie(data.session, data.user);

  const routes = onlyRoutes.length
    ? onlyRoutes
    : [...new Set([...discoverRoutes(), ...extraRoutes])].sort();
  let failed = 0;

  async function check(route) {
    try {
      const res = await fetch(base + route, { headers: { cookie }, redirect: "manual" });
      const boundary =
        res.status === 200 && (await res.text()).includes("We could not load this page");
      return { route, status: res.status, boundary };
    } catch (e) {
      return { route, status: 0, boundary: false, error: e.message };
    }
  }

  // Batched rather than one at a time, but still printed in route order, so two
  // runs of the same sweep read the same. Against a built server the whole set
  // finishes in seconds; against a dev server pass --concurrency=1, because
  // parallel first-request compiles fight over the same CPU.
  const results = [];
  for (let start = 0; start < routes.length; start += concurrency) {
    results.push(...(await Promise.all(routes.slice(start, start + concurrency).map(check))));
  }

  for (const { route, status, boundary, error } of results) {
    if (error) {
      console.log(`FAIL ${route} → ${error}`);
      failed++;
      continue;
    }
    const ok = status === 200 && !boundary;
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${route} → ${status}${boundary ? " (error boundary)" : ""}`);
  }

  console.log(`\n${routes.length - failed} of ${routes.length} pages rendered`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("smoke error:", e.message);
  process.exitCode = 1;
});
