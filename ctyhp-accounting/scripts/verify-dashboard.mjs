// Verify an AUTHENTICATED page renders server-side (catches RSC/antd errors).
// Signs in, reconstructs the @supabase/ssr auth cookie, and fetches /dashboard.
// Run: node --env-file=.env.local scripts/verify-dashboard.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = new URL(url).hostname.split(".")[0];
const base = `sb-${ref}-auth-token`;
const MAX = 3180;

const sb = createClient(url, key, { auth: { persistSession: false } });

function cookieHeader(session) {
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= MAX) return `${base}=${value}`;
  const chunks = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  return chunks.map((c, i) => `${base}.${i}=${c}`).join("; ");
}

async function main() {
  const { data, error } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn",
    password: "Ctyhp@Ketoan2026",
  });
  if (error) throw new Error(`sign-in: ${error.message}`);

  const cookie = cookieHeader(data.session);
  for (const path of ["/dashboard", "/accounts"]) {
    const res = await fetch(`http://localhost:3000${path}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const body = await res.text();
    const rendered =
      path === "/dashboard" ? body.includes("Bảng điều khiển") : body.includes("Hệ thống tài khoản");
    const crashed = body.includes("Element type is invalid") || body.includes("Runtime Error");
    console.log(
      `${path}: HTTP ${res.status} · rendered=${rendered} · crashed=${crashed}` +
        (rendered && !crashed ? "  PASS" : "  FAIL"),
    );
  }
}

main().catch((e) => {
  console.error("verify error:", e.message);
  process.exitCode = 1;
});
