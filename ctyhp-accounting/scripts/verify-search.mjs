// scripts/verify-search.mjs
// E2E verify of the top-bar global search: it finds documents by number and
// contacts by name, honours the limit, needs at least a real query, and — the
// point of not making it SECURITY DEFINER — returns nothing to a suspended user,
// because RLS still applies. Self-cleaning.
// Run: node --env-file=.env.local scripts/verify-search.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { requireDestructiveE2eEnvironment } from "./e2e-environment.mjs";

const {
  databaseUrl,
  supabaseUrl,
  anonKey,
  email,
  password,
  secondaryEmail,
  secondaryPassword,
} = requireDestructiveE2eEnvironment();

const url = supabaseUrl;
const key = anonKey;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };

const CUSTOMER = "E2E Search Customer";
const VENDOR = "E2E Search Vendor";
const ITEM_CODE = "E2E-SRCH";
const CLERK_EMAIL = secondaryEmail;
const CLERK_PASSWORD = secondaryPassword;

const search = async (client, q, limit = 10) => {
  const { data, error } = await client.rpc("acc_global_search", { p_query: q, p_limit: limit });
  if (error) throw new Error(`search "${q}": ${error.message}`);
  return data ?? [];
};

async function main() {
  await db.connect();
  const { data: auth, error: eLogin } = await sb.auth.signInWithPassword({
    email, password,
  });
  if (eLogin) throw new Error("login: " + eLogin.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const base = (await db.query("select code from acc_currency where is_base")).rows[0].code;
  const income = (await db.query("select id from acc_account where account_code='4000'")).rows[0].id;

  const customerId = (await db.query(
    "insert into acc_customer (name, currency_code) values ($1, $2) returning id", [CUSTOMER, base],
  )).rows[0].id;
  const vendorId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ($1, $2) returning id", [VENDOR, base],
  )).rows[0].id;
  const itemId = (await db.query(
    `insert into acc_item (item_code, name, is_sold, sales_price_minor, income_account_id)
     values ($1, 'E2E Search Widget', true, 1000, $2) returning id`, [ITEM_CODE, income],
  )).rows[0].id;
  // An issued invoice so there is a document number to look for.
  const invoiceId = (await db.query(
    `insert into acc_invoice (invoice_number, customer_id, issue_date, currency_code,
       subtotal_minor, tax_total_minor, total_minor, balance_due_minor, status)
     values ('E2E-SRCH-001', $1, current_date, $2, 1000, 0, 1000, 1000, 'issued') returning id`,
    [customerId, base],
  )).rows[0].id;

  // ---- Finding things ----------------------------------------------------
  const byNumber = await search(authed, "E2E-SRCH-001");
  check("finds an invoice by its number",
    byNumber.some((r) => r.kind === "invoice" && r.id === invoiceId), `(n=${byNumber.length})`);
  check("returns a link to the invoice list", byNumber[0]?.href === "/invoices", `(=${byNumber[0]?.href})`);
  check("returns the customer as the sublabel", byNumber[0]?.sublabel === CUSTOMER);

  const byCustomer = await search(authed, "E2E Search Customer");
  check("finds a customer by name", byCustomer.some((r) => r.kind === "customer" && r.id === customerId));

  const byVendor = await search(authed, "search vendor");
  check("matches case-insensitively on a partial name",
    byVendor.some((r) => r.kind === "vendor" && r.id === vendorId));

  const byItemCode = await search(authed, ITEM_CODE);
  check("finds a product by its code", byItemCode.some((r) => r.kind === "item" && r.id === itemId));

  const broad = await search(authed, "E2E Search");
  check("returns several kinds for a broad query",
    new Set(broad.map((r) => r.kind)).size >= 2, `(kinds=${[...new Set(broad.map((r) => r.kind))].join(",")})`);

  const limited = await search(authed, "E2E Search", 2);
  check("honours the limit", limited.length <= 2, `(n=${limited.length})`);

  check("an empty query returns nothing", (await search(authed, "   ")).length === 0);

  // ---- RLS still applies (the reason this is not SECURITY DEFINER) -------
  await db.query(
    `update auth.users
        set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now())
      where email = $1`,
    [CLERK_EMAIL, CLERK_PASSWORD],
  );
  const clerkExists = (await db.query("select id from auth.users where email=$1", [CLERK_EMAIL])).rows[0];
  if (clerkExists) {
    await db.query(
      `insert into acc_app_user (id, full_name, role, status) values ($1, 'E2E Clerk', 'accountant', 'active')
       on conflict (id) do update set role='accountant', status='active'`,
      [clerkExists.id],
    );
    const { data: clerkAuth, error: eClerk } = await sb.auth.signInWithPassword({
      email: CLERK_EMAIL, password: CLERK_PASSWORD,
    });
    if (eClerk) throw new Error("clerk login: " + (eClerk.message || eClerk.code));
    const asClerk = createClient(url, key, {
      global: { headers: { Authorization: "Bearer " + clerkAuth.session.access_token } },
      auth: { persistSession: false },
    });

    check("an active user finds the customer", (await search(asClerk, CUSTOMER)).length >= 1);

    await db.query("update acc_app_user set status='suspended' where id=$1", [clerkExists.id]);
    check("a suspended user finds nothing (RLS applies to the search)",
      (await search(asClerk, CUSTOMER)).length === 0);
    await db.query(
      "update acc_app_user set role='viewer', status='offboarded', status_reason='E2E fixture — no access' where id=$1",
      [clerkExists.id],
    );
  } else {
    console.log("  (skip) no second user available for the RLS check");
  }

  // ---- Cleanup -----------------------------------------------------------
  await db.query("begin");
  await db.query("delete from acc_invoice_line where invoice_id=$1", [invoiceId]);
  await db.query("delete from acc_invoice where id=$1", [invoiceId]);
  await db.query("delete from acc_customer where name=$1", [CUSTOMER]);
  await db.query("delete from acc_vendor where name=$1", [VENDOR]);
  await db.query("delete from acc_item where item_code=$1", [ITEM_CODE]);
  await db.query("commit");

  const left = (await db.query(
    `select (select count(*) from acc_customer where name=$1)
          + (select count(*) from acc_vendor where name=$2)
          + (select count(*) from acc_item where item_code=$3) c`,
    [CUSTOMER, VENDOR, ITEM_CODE],
  )).rows[0].c;
  check("cleanup left nothing behind", Number(left) === 0, `(=${left})`);
  check("the search finds nothing once the fixtures are gone",
    (await search(authed, "E2E Search")).length === 0);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
