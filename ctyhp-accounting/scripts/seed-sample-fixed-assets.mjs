/**
 * Register a plausible fixed asset register in each sample company.
 *
 * Five of the first seven defect reports against this system were really one
 * thing: a sample company with no data reads as a broken feature. The fixed
 * asset register was the latest — "zero registered assets" reported as a
 * finding when the module was working perfectly. This gives the sample
 * companies something to show.
 *
 * Two limits, both deliberate:
 *
 * 1. It refuses any company not flagged `is_sample` in the register. That flag
 *    is the same boundary `tests/e2e/company-isolation.e2e.ts` trusts, and
 *    invented property has no business in books somebody files from.
 * 2. It registers only. Registering touches no ledger — schedules are created
 *    `planned` with no journal entry — so everything here can be removed again.
 *    Posting depreciation would debit 6800 and credit 1590 for real, and that
 *    is a decision for whoever owns the books, not for a seed script.
 *
 * Re-running is safe: an asset whose name is already registered is skipped.
 *
 * Run: node --env-file=.env.local scripts/seed-sample-fixed-assets.mjs
 */
import pg from "pg";

/**
 * Useful lives follow ordinary book convention: computers three years, phones
 * two, furniture and display fixtures seven, plant and leasehold work ten.
 */
const REGISTERS = {
  co_north_star: [
    ["Bridal fitting room build-out", "Leasehold Improvements", "2024-03-01", 4_850_000, 0, 120, "Showroom"],
    ["Showroom air conditioning unit", "Plant and Equipment", "2024-04-15", 1_240_000, 0, 120, "Showroom"],
    ["Gown display racks (set of 12)", "Fixtures and Fittings", "2024-05-02", 686_000, 0, 84, "Showroom"],
    ["Client lounge sofa set", "Furniture", "2024-05-02", 412_500, 25_000, 84, "Client lounge"],
    ["MacBook Pro 14 — consultations", "Computer Equipment", "2025-02-10", 249_900, 0, 36, "Front desk"],
    ["iPhone 15 — store line", "Computer Equipment", "2025-02-10", 89_900, 0, 24, "Front desk"],
    ["Bridal steamer and press station", "Plant and Equipment", "2025-06-01", 318_000, 0, 60, "Back of house"],
  ],
  co_harbor_gems: [
    ["Gemological microscope", "Jewelry Production Equipment", "2024-01-15", 850_000, 50_000, 60, "Grading room"],
    ["Precision carat scale", "Jewelry Production Equipment", "2024-01-15", 176_000, 0, 60, "Grading room"],
    ["Grading room lighting rig", "Leasehold Improvements", "2024-02-01", 943_000, 0, 120, "Grading room"],
    ["Secure display cabinets (set of 6)", "Fixtures and Fittings", "2024-02-20", 528_000, 0, 84, "Trading floor"],
    ["Vault safe — TL30", "Plant and Equipment", "2024-03-05", 2_150_000, 200_000, 120, "Vault"],
    ["Dell Precision workstation", "Computer Equipment", "2025-01-20", 312_000, 0, 36, "Grading room"],
    ["Trading floor air conditioning", "Plant and Equipment", "2025-03-12", 1_090_000, 0, 120, "Trading floor"],
  ],
  co_cascade_metals: [
    ["Rolling mill", "Jewelry Production Equipment", "2024-02-01", 3_400_000, 300_000, 120, "Workshop"],
    ["Casting furnace", "Jewelry Production Equipment", "2024-02-01", 1_875_000, 125_000, 120, "Workshop"],
    ["Fume extraction system", "Plant and Equipment", "2024-02-15", 1_260_000, 0, 120, "Workshop"],
    ["Workshop bench fit-out", "Leasehold Improvements", "2024-03-01", 2_180_000, 0, 120, "Workshop"],
    ["Stock shelving system", "Fixtures and Fittings", "2024-04-10", 394_000, 0, 84, "Store room"],
    ["Office desks and chairs", "Furniture", "2024-04-10", 268_000, 0, 84, "Office"],
    ["ThinkPad T14 — workshop office", "Computer Equipment", "2025-05-06", 168_000, 0, 36, "Office"],
    ["Samsung Galaxy — dispatch line", "Computer Equipment", "2025-05-06", 74_900, 0, 24, "Dispatch"],
  ],
};

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ADMIN =
  process.env.ADMIN_USER_ID ??
  (
    await client.query(
      `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
    )
  ).rows[0]?.id;
if (!ADMIN) {
  console.error("No active admin to register assets as; set ADMIN_USER_ID.");
  process.exit(1);
}

const { rows: companies } = await client.query(
  `select schema_name, legal_name, is_sample from onebook.company order by display_order`,
);

let registered = 0;
let skipped = 0;

for (const company of companies) {
  const plan = REGISTERS[company.schema_name];
  if (!plan) continue;

  // The guard that matters. A company that is not flagged as a sample holds
  // books somebody reports from, and invented property does not belong there.
  if (!company.is_sample) {
    console.log(`\n[${company.schema_name}] SKIPPED — not flagged is_sample`);
    continue;
  }

  console.log(`\n[${company.schema_name}] ${company.legal_name}`);
  await client.query("begin");
  try {
    await client.query(`set local search_path to ${JSON.stringify(company.schema_name).replaceAll('"', '"')}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ADMIN, role: "authenticated" }),
    ]);

    const accountId = async (code) => {
      const { rows } = await client.query(`select id from acc_account where account_code = $1`, [code]);
      if (!rows[0]) throw new Error(`account ${code} is missing from this chart`);
      return rows[0].id;
    };
    const assetAccount = await accountId("1500");
    const accumAccount = await accountId("1590");
    const expenseAccount = await accountId("6800");

    for (const [name, category, inService, cost, salvage, life, location] of plan) {
      const { rows: existing } = await client.query(
        `select id from acc_fixed_asset where name = $1`,
        [name],
      );
      if (existing[0]) {
        skipped++;
        console.log(`  skip  ${name}`);
        continue;
      }
      await client.query(
        `select acc_register_fixed_asset(
           $1, $2, $3, null, $4, $5::date, $5::date, 'USD', $6, $7, $8,
           'straight_line', $9, $10, $11, null, null, 'Sample register')`,
        [
          name,
          `${category} held by ${company.legal_name}`,
          category,
          location,
          inService,
          cost,
          salvage,
          life,
          assetAccount,
          accumAccount,
          expenseAccount,
        ],
      );
      registered++;
      console.log(`  add   ${name} — $${(cost / 100).toLocaleString("en-US")} over ${life} months`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.log(`  FAILED — ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${registered} registered, ${skipped} already present.`);
console.log("No depreciation has been posted; every schedule is still planned.");
await client.end();
