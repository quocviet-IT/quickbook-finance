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
// This sweep only reads: one sign-in, then a GET per route. It therefore does
// NOT require ALLOW_DESTRUCTIVE_E2E, which gates the suites that write and
// which demands a second Supabase project. Sign-in comes from
// `smoke-environment.mjs` and needs no secret beyond what the app already has.
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverStaticRoutes } from "./quality/routes.mjs";
import { sessionCookieHeader } from "./quality/session-cookie.mjs";
import { smokeSession } from "./smoke-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "app", "(app)");

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

async function main() {
  const { session, user, supabaseUrl } = await smokeSession();
  const cookie = sessionCookieHeader({ session, user, supabaseUrl });

  const routes = onlyRoutes.length
    ? onlyRoutes
    : [...new Set([...discoverStaticRoutes(appDir), ...extraRoutes])].sort();
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
