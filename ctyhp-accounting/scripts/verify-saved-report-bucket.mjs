/**
 * Behavioural verification of the onebook-reports bucket.
 *
 * The SQL harness proves the rows; this proves the bytes. It is the only check
 * that the bucket's central claim actually holds: no policy exists for an
 * application session, so an upload without a server-minted ticket must be
 * refused and the bucket must not even be listable.
 *
 * It writes one object under an all-zero company folder that no real company
 * can own, and removes it again. Nothing else in storage is touched.
 *
 * Run: node --env-file=.env.local scripts/verify-saved-report-bucket.mjs
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

const path = `00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}.csv`;
const body = "Account,Balance\r\nCash,100\r\n";
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
};

const ticket = await admin.storage.from("onebook-reports").createSignedUploadUrl(path);
check("a signed upload URL is issued", !ticket.error, ticket.error?.message);

const put = await anon.storage
  .from("onebook-reports")
  .uploadToSignedUrl(path, ticket.data.token, new Blob([body], { type: "text/csv" }));
check("an anonymous client can upload with the ticket", !put.error, put.error?.message);

const direct = await anon.storage
  .from("onebook-reports")
  .upload(`00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}.csv`, new Blob(["x"]));
check("an upload WITHOUT a ticket is refused", Boolean(direct.error), "it was allowed");

const listed = await anon.storage.from("onebook-reports").list("00000000-0000-4000-8000-000000000000");
check("a session cannot list the bucket", (listed.data ?? []).length === 0, JSON.stringify(listed.data));

const link = await admin.storage
  .from("onebook-reports")
  .createSignedUrl(path, 60, { download: "pnl.csv" });
check("a signed download URL is issued", !link.error, link.error?.message);

const fetched = await fetch(link.data.signedUrl);
const text = await fetched.text();
check("the bytes come back unchanged", text === body, JSON.stringify(text));
check(
  "and it is served as a download",
  /attachment/i.test(fetched.headers.get("content-disposition") ?? ""),
  fetched.headers.get("content-disposition") ?? "none",
);

const read = await admin.storage.from("onebook-reports").download(path);
check("the server can read it for a preview", !read.error, read.error?.message);

const gone = await admin.storage.from("onebook-reports").remove([path]);
check("cleanup removed the probe object", !gone.error, gone.error?.message);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
