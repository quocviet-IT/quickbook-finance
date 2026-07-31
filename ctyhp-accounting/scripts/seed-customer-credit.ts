// Fill in what the customer records are missing: the state in USPS form, and
// the credit terms every account should have had from the start.
//
// Run: node --env-file=.env.local scripts/seed-customer-credit.ts
//      node --env-file=.env.local scripts/seed-customer-credit.ts --dry-run
//
// Idempotent: it only writes a field that is empty or in the wrong form, so a
// limit an accountant has since changed is never overwritten. It signs in as a
// real user rather than using the service role, so the audit log names who made
// the change.
//
// The limit itself comes from lib/domain/credit.ts — the same rule the customer
// screen suggests, unit tested there, not a second copy of the arithmetic.
import { createClient } from "@supabase/supabase-js";
import { suggestCreditLimitMinor } from "../lib/domain/credit.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SEED_EMAIL ?? process.env.SMOKE_EMAIL ?? "admin@ctyhp.vn";
const password = process.env.SEED_PASSWORD ?? process.env.SMOKE_PASSWORD ?? "Ctyhp@Ketoan2026";
const dryRun = process.argv.includes("--dry-run");

if (!url || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}

/**
 * Payment terms by how the account trades, not by how big it is.
 *
 * Trade accounts — shops and studios that resell — get the company's standard
 * net 30. Retail customers buying for themselves get net 15: a private buyer
 * carrying a piece for a month is a collections problem, not a credit facility.
 * Named explicitly rather than guessed from the name, because "North Star
 * Bridal" and "Sophia Bennett" are only obvious to a person.
 */
const TRADE_ACCOUNTS = new Set([
  "Grand Avenue Jewelers",
  "Maison Luxe Boutique",
  "North Star Bridal",
  "Sample Customer - Acme Studio",
]);
const TRADE_TERMS_DAYS = 30;
const RETAIL_TERMS_DAYS = 15;

const sb = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: session, error: signInError } = await sb.auth.signInWithPassword({ email, password });
if (signInError || !session.user) {
  console.error(`Could not sign in as ${email}: ${signInError?.message ?? "no user"}`);
  process.exit(1);
}

const { data: states, error: statesError } = await sb.from("acc_us_state").select("code, name");
if (statesError) {
  console.error(`Reading the state list failed: ${statesError.message}`);
  process.exit(1);
}
const codeByName = new Map(
  (states ?? []).map((state) => [String(state.name).toLowerCase(), String(state.code)]),
);
const validCodes = new Set((states ?? []).map((state) => String(state.code)));

const { data: customers, error: customerError } = await sb
  .from("acc_customer")
  .select("id, name, region, credit_limit_minor, credit_terms_days, credit_review_note")
  .order("name");
if (customerError) {
  console.error(`Reading customers failed: ${customerError.message}`);
  process.exit(1);
}

const { data: invoices, error: invoiceError } = await sb
  .from("acc_invoice")
  .select("customer_id, total_minor, balance_due_minor, status")
  .neq("status", "void");
if (invoiceError) {
  console.error(`Reading invoice history failed: ${invoiceError.message}`);
  process.exit(1);
}

interface History {
  count: number;
  totalMinor: number;
  largestMinor: number;
  openMinor: number;
}
const history = new Map<string, History>();
for (const invoice of invoices ?? []) {
  const entry = history.get(invoice.customer_id) ?? {
    count: 0,
    totalMinor: 0,
    largestMinor: 0,
    openMinor: 0,
  };
  entry.count += 1;
  entry.totalMinor += Number(invoice.total_minor);
  entry.largestMinor = Math.max(entry.largestMinor, Number(invoice.total_minor));
  entry.openMinor += Number(invoice.balance_due_minor);
  history.set(invoice.customer_id, entry);
}

const today = new Date().toISOString();
const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
let changed = 0;

for (const customer of customers ?? []) {
  const past = history.get(customer.id) ?? {
    count: 0,
    totalMinor: 0,
    largestMinor: 0,
    openMinor: 0,
  };
  const update: Record<string, unknown> = {};

  // 1. The state, in the two-letter form an American invoice prints and the
  //    sales tax rules match on. "Texas" is a name; "TX" is a jurisdiction.
  const region = (customer.region ?? "").trim();
  if (region && !validCodes.has(region.toUpperCase())) {
    const code = codeByName.get(region.toLowerCase());
    if (code) update.region = code;
  }

  // 2. Terms, and a limit from what they have actually bought.
  const terms = TRADE_ACCOUNTS.has(customer.name) ? TRADE_TERMS_DAYS : RETAIL_TERMS_DAYS;
  if (customer.credit_terms_days === null) update.credit_terms_days = terms;

  if (customer.credit_limit_minor === null) {
    const limit = suggestCreditLimitMinor({
      largestInvoiceMinor: past.largestMinor,
      openBalanceMinor: past.openMinor,
    });
    update.credit_limit_minor = limit;
    update.credit_reviewed_at = today;
    update.credit_review_note =
      past.count > 0
        ? `Opening limit ${money(limit)} set from trading history: ${past.count} invoice(s), ` +
          `largest ${money(past.largestMinor)}, ${money(past.openMinor)} open at review. ` +
          `Net ${terms} days.`
        : `Opening limit ${money(limit)} — no trading history yet, minimum starting limit. ` +
          `Net ${terms} days.`;
  }

  if (Object.keys(update).length === 0) continue;
  changed += 1;
  console.log(
    `${customer.name.padEnd(30)} ${JSON.stringify(update).slice(0, 160)}${dryRun ? "  (dry run)" : ""}`,
  );
  if (dryRun) continue;

  const { error } = await sb.from("acc_customer").update(update).eq("id", customer.id);
  if (error) {
    console.error(`  update failed: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(
  `\n${changed} of ${customers?.length ?? 0} customers ${dryRun ? "would be" : "were"} updated.`,
);
await sb.auth.signOut();
