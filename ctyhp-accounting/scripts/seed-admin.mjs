// Seed the first admin user without a service-role key:
//   1) sign up via the publishable key
//   2) confirm the email + grant the admin role directly in the DB
//   3) verify sign-in works
// Run: ADMIN_EMAIL=.. ADMIN_PASSWORD=.. node --env-file=.env.local scripts/seed-admin.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!url || !key || !email || !password) {
  console.error("Missing env: need URL, ANON key, ADMIN_EMAIL, ADMIN_PASSWORD");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await db.connect();

  let userId;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error && !/already registered|already been registered/i.test(error.message)) {
    throw new Error(`signUp failed: ${error.message}`);
  }
  userId = data?.user?.id;
  if (!userId) {
    const r = await db.query("select id from auth.users where email = $1", [email]);
    if (r.rowCount === 0) throw new Error("User not found after signUp");
    userId = r.rows[0].id;
    console.log("User already existed; reusing.");
  } else {
    console.log("Signed up new user.");
  }

  // Confirm the email so password login is allowed regardless of project settings.
  await db.query(
    "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1",
    [userId],
  );

  // Grant admin role in the application user table.
  await db.query(
    `insert into acc_app_user (id, full_name, role) values ($1, $2, 'admin')
     on conflict (id) do update set role = 'admin'`,
    [userId, "Administrator"],
  );

  // Verify sign-in.
  const check = await supabase.auth.signInWithPassword({ email, password });
  if (check.error) throw new Error(`Sign-in verification failed: ${check.error.message}`);

  console.log(`\nAdmin ready: ${email} (role=admin, id=${userId})`);
  console.log("Sign-in verified OK.");
}

main()
  .catch((e) => {
    console.error("\nSeed error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
