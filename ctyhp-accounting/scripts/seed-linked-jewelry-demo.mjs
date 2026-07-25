// Adds an idempotent, linked jewelry-accounting scenario to Supabase.
// It uses the same posting functions as the web app so inventory, AR/AP,
// banking, tax, and the general ledger remain connected.
//
// Validate without saving:
//   node --env-file=.env.local scripts/seed-linked-jewelry-demo.mjs --dry-run
// Save:
//   node --env-file=.env.local scripts/seed-linked-jewelry-demo.mjs
import pg from "pg";

const MARKER = "CTYHP-LINKED-JEWELRY-DEMO-V1";
const dryRun = process.argv.includes("--dry-run");
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function one(text, params = []) {
  const result = await db.query(text, params);
  if (!result.rows[0]) throw new Error(`Expected one row from: ${text.slice(0, 80)}`);
  return result.rows[0];
}

async function account(code) {
  return one("select id, account_code from acc_account where account_code = $1", [code]);
}

async function ensureAccount({ code, name, type, parentCode, description }, actorId) {
  const parent = parentCode ? await account(parentCode) : null;
  return one(
    `insert into acc_account
       (account_code, name, account_type, detail_type, parent_account_id, description,
        currency_code, is_posting_account, status, effective_from, created_by, approved_by)
     values ($1, $2, $3::acc_account_type, $4, $5, $6, 'USD', true, 'active', '2026-01-01', $7, $7)
     on conflict (account_code) do update
       set name = excluded.name,
           account_type = excluded.account_type,
           detail_type = excluded.detail_type,
           parent_account_id = excluded.parent_account_id,
           description = excluded.description,
           status = 'active',
           updated_at = now()
     returning id, account_code`,
    [code, name, type, name, parent?.id ?? null, description, actorId],
  );
}

async function ensureVendor(values) {
  const found = await db.query("select id from acc_vendor where email = $1 limit 1", [values.email]);
  if (found.rows[0]) return found.rows[0];
  return one(
    `insert into acc_vendor
       (name, email, phone, currency_code, ap_account_id, default_expense_account_id,
        payment_terms)
     values ($1, $2, $3, 'USD', $4, $5, $6)
     returning id`,
    [
      values.name,
      values.email,
      values.phone,
      values.apAccountId,
      values.defaultExpenseAccountId,
      values.paymentTerms,
    ],
  );
}

async function ensureCustomer(values) {
  const found = await db.query("select id from acc_customer where email = $1 limit 1", [
    values.email,
  ]);
  if (found.rows[0]) return found.rows[0];
  return one(
    `insert into acc_customer (name, email, currency_code)
     values ($1, $2, 'USD')
     returning id`,
    [values.name, values.email],
  );
}

async function createPurchaseOrder({
  vendorId,
  orderDate,
  expectedDate,
  memo,
  lines,
  receiveDate,
  billDate,
  dueDate,
  vendorRef,
  paymentDate,
  paymentAmount,
  bankAccountId,
}) {
  const po = await one(
    `select acc_save_purchase_order(
       null::uuid, $1::uuid, $2::date, $3::date, 'USD', $4, $5, $6::jsonb
     ) as id`,
    [
      vendorId,
      orderDate,
      expectedDate,
      "CTYHP Jewelry Showroom, New York, NY",
      `${MARKER}: ${memo}`,
      JSON.stringify(lines),
    ],
  );
  await db.query("select acc_approve_purchase_order($1::uuid)", [po.id]);

  const poLines = (
    await db.query(
      `select id, item_id, quantity, unit_cost_minor
         from acc_purchase_order_line
        where purchase_order_id = $1
        order by line_order`,
      [po.id],
    )
  ).rows;

  if (!receiveDate) return { poId: po.id, poLines };

  const receipt = await one(
    `select acc_receive_purchase_order($1::uuid, $2::date, $3, $4::jsonb) as id`,
    [
      po.id,
      receiveDate,
      `${MARKER}: inventory received and inspected`,
      JSON.stringify(
        poLines.map((line) => ({
          purchase_order_line_id: line.id,
          quantity: Number(line.quantity),
        })),
      ),
    ],
  );

  if (!billDate) return { poId: po.id, poLines, receiptId: receipt.id };

  const bill = await one(
    `select acc_create_bill_from_po(
       $1::uuid, $2::date, $3::date, $4, $5, $6::jsonb, null
     ) as id`,
    [
      po.id,
      billDate,
      dueDate,
      vendorRef,
      `${MARKER}: three-way matched inventory bill`,
      JSON.stringify(
        poLines.map((line) => ({
          purchase_order_line_id: line.id,
          quantity: Number(line.quantity),
          unit_cost_minor: Number(line.unit_cost_minor),
        })),
      ),
    ],
  );
  await db.query("select acc_post_bill($1::uuid)", [bill.id]);

  let billPaymentId = null;
  if (paymentAmount > 0) {
    const payment = await one(
      `select acc_pay_bills(
         $1::uuid, $2::date, 'USD', $3::bigint, $4::uuid, 'bank_transfer',
         $5, $6::jsonb
       ) as id`,
      [
        vendorId,
        paymentDate,
        paymentAmount,
        bankAccountId,
        `${MARKER}: vendor payment`,
        JSON.stringify([{ bill_id: bill.id, amount_minor: paymentAmount }]),
      ],
    );
    billPaymentId = payment.id;
  }

  return {
    poId: po.id,
    poLines,
    receiptId: receipt.id,
    billId: bill.id,
    billPaymentId,
  };
}

function calculateInvoiceLines(specs, itemByCode, taxCode) {
  return specs.map((spec) => {
    const item = itemByCode.get(spec.code);
    if (!item) throw new Error(`Missing item ${spec.code}`);
    const subtotal = Math.round(spec.quantity * spec.unitPriceMinor);
    const tax = spec.taxable === false ? 0 : Math.round((subtotal * 825) / 10000);
    return {
      item,
      description: spec.description ?? item.name,
      quantity: spec.quantity,
      unitPriceMinor: spec.unitPriceMinor,
      incomeAccountId: item.income_account_id,
      taxCodeId: spec.taxable === false ? null : taxCode.id,
      subtotal,
      tax,
      total: subtotal + tax,
    };
  });
}

async function createInvoice({
  customerId,
  date,
  dueDate,
  memo,
  lineSpecs,
  itemByCode,
  taxCode,
  paymentDate,
  paymentAmount,
  bankAccountId,
}) {
  const lines = calculateInvoiceLines(lineSpecs, itemByCode, taxCode);
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const taxTotal = lines.reduce((sum, line) => sum + line.tax, 0);
  const total = subtotal + taxTotal;

  const invoice = await one(
    `insert into acc_invoice
       (customer_id, issue_date, due_date, currency_code, subtotal_minor,
        tax_total_minor, total_minor, status, memo)
     values ($1, $2::date, $3::date, 'USD', $4, $5, $6, 'draft', $7)
     returning id`,
    [customerId, date, dueDate, subtotal, taxTotal, total, `${MARKER}: ${memo}`],
  );

  for (const [index, line] of lines.entries()) {
    await db.query(
      `insert into acc_invoice_line
         (invoice_id, line_order, description, quantity, unit_price_minor,
          income_account_id, tax_code_id, item_id, line_subtotal_minor,
          line_tax_minor, line_total_minor)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        invoice.id,
        index,
        line.description,
        line.quantity,
        line.unitPriceMinor,
        line.incomeAccountId,
        line.taxCodeId,
        line.item.id,
        line.subtotal,
        line.tax,
        line.total,
      ],
    );
  }

  await db.query("select acc_issue_invoice($1::uuid)", [invoice.id]);

  let paymentId = null;
  if (paymentAmount > 0) {
    if (paymentAmount > total) throw new Error("Payment exceeds seeded invoice total");
    const payment = await one(
      `select acc_record_payment(
         $1::uuid, $2::date, 'USD', $3::bigint, $4::uuid, 'bank_transfer',
         $5, $6::jsonb
       ) as id`,
      [
        customerId,
        paymentDate,
        paymentAmount,
        bankAccountId,
        `${MARKER}: customer receipt`,
        JSON.stringify([{ invoice_id: invoice.id, amount_minor: paymentAmount }]),
      ],
    );
    paymentId = payment.id;
  }

  return { invoiceId: invoice.id, paymentId, total, paymentDate, paymentAmount };
}

async function recordExpense({
  vendorId,
  bankAccountId,
  date,
  memo,
  accountId,
  amount,
}) {
  return one(
    `select acc_record_expense(
       $1::uuid, $2::uuid, $3::date, 'USD', $4, $5::jsonb
     ) as id`,
    [
      vendorId,
      bankAccountId,
      date,
      `${MARKER}: ${memo}`,
      JSON.stringify([
        {
          expense_account_id: accountId,
          amount_minor: amount,
          description: memo,
        },
      ]),
    ],
  );
}

async function ledgerNet(accountId) {
  const row = await one(
    `select coalesce(sum(
       case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end
     ), 0)::bigint as balance
     from acc_journal_line l
     join acc_journal_entry e on e.id = l.journal_entry_id
     where l.account_id = $1 and e.status = 'posted'`,
    [accountId],
  );
  return Number(row.balance);
}

async function main() {
  await db.connect();
  await db.query("begin");

  const existing = await db.query(
    "select id from acc_purchase_order where memo like $1 limit 1",
    [`${MARKER}%`],
  );
  if (existing.rows[0]) {
    await db.query("rollback");
    console.log("Linked jewelry demo already exists; no changes were made.");
    return;
  }

  const actor = await one(
    `select id as user_id
       from acc_app_user
      where role = 'admin'
      order by created_at
      limit 1`,
  );
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: actor.user_id, role: "authenticated" }),
  ]);
  const identity = await one("select auth.uid() as user_id, acc_current_role()::text as role");
  if (identity.user_id !== actor.user_id || identity.role !== "admin") {
    throw new Error("Could not establish the admin database session used by posting functions");
  }

  const bank = await account("1010");
  const inventory = await account("1200");
  const ap = await account("2000");
  const grni = await account("2150");
  const operatingExpense = await account("6000");
  const inventoryOpening = await ledgerNet(inventory.id);
  const grniOpening = await ledgerNet(grni.id);

  const jewelrySales = await ensureAccount(
    {
      code: "4010",
      name: "Jewelry Sales",
      type: "income",
      parentCode: "4000",
      description: "Revenue from finished jewelry and accessories",
    },
  );
  const jewelryCogs = await ensureAccount(
    {
      code: "5010",
      name: "Jewelry Cost of Goods Sold",
      type: "cost_of_goods_sold",
      parentCode: "5000",
      description: "Weighted-average cost relieved when jewelry is sold",
    },
  );
  const rentExpense = await ensureAccount(
    {
      code: "6010",
      name: "Showroom Rent",
      type: "expense",
      parentCode: "6000",
      description: "Retail showroom and office rent",
    },
  );
  const marketingExpense = await ensureAccount(
    {
      code: "6020",
      name: "Marketing and Photography",
      type: "expense",
      parentCode: "6000",
      description: "Campaign, photography, and creative contractor costs",
    },
  );
  const insuranceExpense = await ensureAccount(
    {
      code: "6030",
      name: "Jewelry Insurance",
      type: "expense",
      parentCode: "6000",
      description: "Inventory and showroom insurance",
    },
  );
  const shippingExpense = await ensureAccount(
    {
      code: "6040",
      name: "Shipping and Packaging",
      type: "expense",
      parentCode: "6000",
      description: "Insured shipping and packaging consumed",
    },
    actor.user_id,
  );

  const taxCode = await one("select id from acc_tax_code where code = 'TAX'");
  const itemSetup = [
    ["JEWELRY-DEMO-RING-001", 260000, 120000],
    ["JEWELRY-DEMO-EARRING-001", 145000, 70000],
    ["JEWELRY-DEMO-PENDANT-001", 120000, 55000],
    ["JEWELRY-DEMO-NECKLACE-001", 29500, 9500],
    ["JEWELRY-DEMO-BRACELET-001", 95000, 42000],
    ["JEWELRY-DEMO-EARRING-002", 32000, 14000],
    ["JEWELRY-DEMO-BOX-001", 2500, 800],
  ];
  for (const [code, salesPrice, purchaseCost] of itemSetup) {
    const updated = await db.query(
      `update acc_item
          set is_sold = true,
              sales_price_minor = $2,
              income_account_id = $3,
              sales_tax_code_id = $4,
              is_purchased = true,
              purchase_cost_minor = $5,
              expense_account_id = $6,
              is_inventory = true,
              inventory_account_id = $7,
              cogs_account_id = $6,
              updated_at = now()
        where item_code = $1
        returning id`,
      [
        code,
        salesPrice,
        jewelrySales.id,
        taxCode.id,
        purchaseCost,
        jewelryCogs.id,
        inventory.id,
      ],
    );
    if (!updated.rows[0]) throw new Error(`Catalog item ${code} was not found`);
  }
  await db.query(
    `update acc_item
        set income_account_id = (select id from acc_account where account_code = '4100'),
            sales_tax_code_id = $2,
            is_purchased = false,
            sales_price_minor = case item_code
              when 'JEWELRY-DEMO-SVC-ENGRAVE' then 8500
              when 'JEWELRY-DEMO-SVC-REPAIR' then 16500
              else sales_price_minor
            end,
            updated_at = now()
      where item_code = any($1::text[])`,
    [
      ["JEWELRY-DEMO-SVC-ENGRAVE", "JEWELRY-DEMO-SVC-REPAIR"],
      taxCode.id,
    ],
  );

  const itemRows = (
    await db.query(
      `select id, item_code, name, income_account_id
         from acc_item
        where item_code = any($1::text[])`,
      [
        [
          ...itemSetup.map(([code]) => code),
          "JEWELRY-DEMO-CLEAN-001",
          "JEWELRY-DEMO-SVC-ENGRAVE",
        ],
      ],
    )
  ).rows;
  const itemByCode = new Map(itemRows.map((item) => [item.item_code, item]));

  const gemVendor = await ensureVendor(
    {
      name: "Aurora Gemstone Supply Inc.",
      email: "ap@auroragems.example",
      phone: "(212) 555-0141",
      apAccountId: ap.id,
      defaultExpenseAccountId: jewelryCogs.id,
      paymentTerms: "Net 30",
    },
    actor.user_id,
  );
  const metalVendor = await ensureVendor(
    {
      name: "Heritage Precious Metals LLC",
      email: "billing@heritagemetals.example",
      phone: "(646) 555-0178",
      apAccountId: ap.id,
      defaultExpenseAccountId: jewelryCogs.id,
      paymentTerms: "Net 30",
    },
    actor.user_id,
  );
  const creativeVendor = await ensureVendor(
    {
      name: "Luna Creative Studio",
      email: "hello@lunacreative.example",
      phone: "(917) 555-0122",
      apAccountId: ap.id,
      defaultExpenseAccountId: marketingExpense.id,
      paymentTerms: "Due on receipt",
    },
    actor.user_id,
  );
  const propertyVendor = await ensureVendor(
    {
      name: "Fifth Avenue Properties LLC",
      email: "rent@fifthaveproperties.example",
      phone: "(212) 555-0190",
      apAccountId: ap.id,
      defaultExpenseAccountId: rentExpense.id,
      paymentTerms: "Due on receipt",
    },
    actor.user_id,
  );
  const insuranceVendor = await ensureVendor(
    {
      name: "JewelSafe Insurance Group",
      email: "billing@jewelsafe.example",
      phone: "(800) 555-0155",
      apAccountId: ap.id,
      defaultExpenseAccountId: insuranceExpense.id,
      paymentTerms: "Due on receipt",
    },
    actor.user_id,
  );

  const taxProfiles = [
    [gemVendor.id, "Aurora Gemstone Supply Inc.", "c_corporation", false, null, "XX-XXX-4821"],
    [metalVendor.id, "Heritage Precious Metals LLC", "llc", false, null, "XX-XXX-7354"],
    [creativeVendor.id, "Luna Creative Studio", "sole_proprietor", true, "NEC-1", "XXX-XX-6184"],
    [propertyVendor.id, "Fifth Avenue Properties LLC", "llc", true, "MISC-1", "XX-XXX-2098"],
    [insuranceVendor.id, "JewelSafe Insurance Group", "c_corporation", false, null, "XX-XXX-5531"],
  ];
  for (const [vendorId, reportingName, classification, eligible, boxCode, tinRef] of taxProfiles) {
    await db.query(
      `insert into acc_vendor_tax_profile
         (vendor_id, version, w9_status, w9_received_date, classification, reporting_name,
          tin_ref, tin_type, address_line1, city, region, postal_code, country,
          is_1099_eligible, box_code, eligibility_override, change_reason, created_by)
       values
         ($1, 1, 'on_file', '2026-01-05', $2::acc_tax_classification, $3,
          $4, 'ein', '125 Jewelry District', 'New York', 'NY', '10036', 'US',
          $5, $6, false, $7, $8)`,
      [
        vendorId,
        classification,
        reportingName,
        tinRef,
        eligible,
        boxCode,
        `${MARKER}: initial sample W-9 profile`,
        actor.user_id,
      ],
    );
  }

  const maison = await ensureCustomer({
    name: "Maison Luxe Boutique",
    email: "accounting@maisonluxe.example",
  });
  const elena = await ensureCustomer({
    name: "Elena Brooks",
    email: "elena.brooks@example.com",
  });
  const northStar = await ensureCustomer({
    name: "North Star Bridal",
    email: "purchasing@northstarbridal.example",
  });
  const grandAvenue = await ensureCustomer({
    name: "Grand Avenue Jewelers",
    email: "ap@grandavenuejewelers.example",
  });
  const daniel = await ensureCustomer({
    name: "Daniel Carter",
    email: "daniel.carter@example.com",
  });
  const sophia = await ensureCustomer({
    name: "Sophia Reynolds",
    email: "sophia.reynolds@example.com",
  });

  const po1 = await createPurchaseOrder({
    vendorId: gemVendor.id,
    orderDate: "2026-01-05",
    expectedDate: "2026-01-12",
    memo: "diamond and sapphire collection",
    lines: [
      {
        item_id: itemByCode.get("JEWELRY-DEMO-RING-001").id,
        description: "18K Gold Diamond Ring",
        quantity: 10,
        unit_cost_minor: 120000,
        expense_account_id: jewelryCogs.id,
      },
      {
        item_id: itemByCode.get("JEWELRY-DEMO-EARRING-001").id,
        description: "Diamond Stud Earrings",
        quantity: 15,
        unit_cost_minor: 70000,
        expense_account_id: jewelryCogs.id,
      },
      {
        item_id: itemByCode.get("JEWELRY-DEMO-PENDANT-001").id,
        description: "Blue Sapphire Pendant",
        quantity: 8,
        unit_cost_minor: 55000,
        expense_account_id: jewelryCogs.id,
      },
    ],
    receiveDate: "2026-01-10",
    billDate: "2026-01-12",
    dueDate: "2026-02-11",
    vendorRef: "AGS-260112",
    paymentDate: "2026-01-25",
    paymentAmount: 1200000,
    bankAccountId: bank.id,
  });
  const po2 = await createPurchaseOrder({
    vendorId: metalVendor.id,
    orderDate: "2026-03-01",
    expectedDate: "2026-03-08",
    memo: "spring gold and pearl collection",
    lines: [
      {
        item_id: itemByCode.get("JEWELRY-DEMO-NECKLACE-001").id,
        description: "Sterling Silver Necklace",
        quantity: 20,
        unit_cost_minor: 9500,
        expense_account_id: jewelryCogs.id,
      },
      {
        item_id: itemByCode.get("JEWELRY-DEMO-BRACELET-001").id,
        description: "Classic Gold Bracelet",
        quantity: 12,
        unit_cost_minor: 42000,
        expense_account_id: jewelryCogs.id,
      },
      {
        item_id: itemByCode.get("JEWELRY-DEMO-EARRING-002").id,
        description: "Pearl Drop Earrings",
        quantity: 15,
        unit_cost_minor: 14000,
        expense_account_id: jewelryCogs.id,
      },
    ],
    receiveDate: "2026-03-06",
    billDate: "2026-03-08",
    dueDate: "2026-04-07",
    vendorRef: "HPM-030826",
    paymentDate: "2026-03-20",
    paymentAmount: 904000,
    bankAccountId: bank.id,
  });
  const po3 = await createPurchaseOrder({
    vendorId: metalVendor.id,
    orderDate: "2026-06-15",
    expectedDate: "2026-06-25",
    memo: "premium gift-box replenishment awaiting vendor bill",
    lines: [
      {
        item_id: itemByCode.get("JEWELRY-DEMO-BOX-001").id,
        description: "Premium Jewelry Gift Box",
        quantity: 100,
        unit_cost_minor: 800,
        expense_account_id: jewelryCogs.id,
      },
    ],
    receiveDate: "2026-06-25",
    billDate: null,
    dueDate: null,
    vendorRef: null,
    paymentDate: null,
    paymentAmount: 0,
    bankAccountId: bank.id,
  });
  const po4 = await createPurchaseOrder({
    vendorId: gemVendor.id,
    orderDate: "2026-07-20",
    expectedDate: "2026-08-05",
    memo: "open fall collection purchase order",
    lines: [
      {
        item_id: itemByCode.get("JEWELRY-DEMO-RING-001").id,
        description: "18K Gold Diamond Ring",
        quantity: 5,
        unit_cost_minor: 122500,
        expense_account_id: jewelryCogs.id,
      },
      {
        item_id: itemByCode.get("JEWELRY-DEMO-PENDANT-001").id,
        description: "Blue Sapphire Pendant",
        quantity: 5,
        unit_cost_minor: 56500,
        expense_account_id: jewelryCogs.id,
      },
    ],
    receiveDate: null,
    billDate: null,
    dueDate: null,
    vendorRef: null,
    paymentDate: null,
    paymentAmount: 0,
    bankAccountId: bank.id,
  });

  const sales = [];
  sales.push(
    await createInvoice({
      customerId: maison.id,
      date: "2026-02-20",
      dueDate: "2026-03-22",
      memo: "wholesale diamond collection",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: "2026-02-27",
      paymentAmount: 1033788,
      lineSpecs: [
        { code: "JEWELRY-DEMO-RING-001", quantity: 2, unitPriceMinor: 260000 },
        { code: "JEWELRY-DEMO-EARRING-001", quantity: 3, unitPriceMinor: 145000 },
      ],
    }),
  );
  sales.push(
    await createInvoice({
      customerId: elena.id,
      date: "2026-03-22",
      dueDate: "2026-04-21",
      memo: "custom bridal jewelry order",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: "2026-03-25",
      paymentAmount: 100000,
      lineSpecs: [
        { code: "JEWELRY-DEMO-NECKLACE-001", quantity: 2, unitPriceMinor: 29500 },
        { code: "JEWELRY-DEMO-BRACELET-001", quantity: 1, unitPriceMinor: 95000 },
        { code: "JEWELRY-DEMO-SVC-ENGRAVE", quantity: 1, unitPriceMinor: 8500 },
      ],
    }),
  );
  sales.push(
    await createInvoice({
      customerId: northStar.id,
      date: "2026-04-15",
      dueDate: "2026-05-15",
      memo: "bridal showcase inventory",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: "2026-04-25",
      paymentAmount: 1732000,
      lineSpecs: [
        { code: "JEWELRY-DEMO-RING-001", quantity: 3, unitPriceMinor: 260000 },
        { code: "JEWELRY-DEMO-EARRING-001", quantity: 4, unitPriceMinor: 145000 },
        { code: "JEWELRY-DEMO-PENDANT-001", quantity: 2, unitPriceMinor: 120000 },
      ],
    }),
  );
  sales.push(
    await createInvoice({
      customerId: daniel.id,
      date: "2026-05-09",
      dueDate: "2026-06-08",
      memo: "anniversary gift purchase",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: null,
      paymentAmount: 0,
      lineSpecs: [
        { code: "JEWELRY-DEMO-PENDANT-001", quantity: 1, unitPriceMinor: 120000 },
        { code: "JEWELRY-DEMO-NECKLACE-001", quantity: 1, unitPriceMinor: 29500 },
        { code: "JEWELRY-DEMO-CLEAN-001", quantity: 1, unitPriceMinor: 4500 },
      ],
    }),
  );
  sales.push(
    await createInvoice({
      customerId: grandAvenue.id,
      date: "2026-06-14",
      dueDate: "2026-07-14",
      memo: "summer wholesale restock",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: "2026-06-28",
      paymentAmount: 300000,
      lineSpecs: [
        { code: "JEWELRY-DEMO-BRACELET-001", quantity: 4, unitPriceMinor: 95000 },
        { code: "JEWELRY-DEMO-EARRING-002", quantity: 6, unitPriceMinor: 32000 },
      ],
    }),
  );
  sales.push(
    await createInvoice({
      customerId: sophia.id,
      date: "2026-07-10",
      dueDate: "2026-08-09",
      memo: "engagement ring with engraving",
      itemByCode,
      taxCode,
      bankAccountId: bank.id,
      paymentDate: "2026-07-12",
      paymentAmount: 290651,
      lineSpecs: [
        { code: "JEWELRY-DEMO-RING-001", quantity: 1, unitPriceMinor: 260000 },
        { code: "JEWELRY-DEMO-SVC-ENGRAVE", quantity: 1, unitPriceMinor: 8500 },
      ],
    }),
  );

  const expenses = [];
  for (const [date, amount] of [
    ["2026-01-03", 320000],
    ["2026-04-03", 320000],
    ["2026-07-03", 320000],
  ]) {
    expenses.push({
      ...(await recordExpense({
        vendorId: propertyVendor.id,
        bankAccountId: bank.id,
        date,
        memo: "showroom rent",
        accountId: rentExpense.id,
        amount,
      })),
      date,
      amount,
      description: "Fifth Avenue showroom rent",
    });
  }
  for (const [date, amount, description] of [
    ["2026-02-08", 90000, "Valentine campaign photography"],
    ["2026-04-08", 120000, "Spring bridal campaign"],
    ["2026-06-08", 150000, "Summer collection creative"],
  ]) {
    expenses.push({
      ...(await recordExpense({
        vendorId: creativeVendor.id,
        bankAccountId: bank.id,
        date,
        memo: description,
        accountId: marketingExpense.id,
        amount,
      })),
      date,
      amount,
      description,
    });
  }
  expenses.push({
    ...(await recordExpense({
      vendorId: insuranceVendor.id,
      bankAccountId: bank.id,
      date: "2026-03-12",
      memo: "annual jewelry inventory insurance",
      accountId: insuranceExpense.id,
      amount: 240000,
    })),
    date: "2026-03-12",
    amount: 240000,
    description: "Jewelry inventory insurance",
  });
  expenses.push({
    ...(await recordExpense({
      vendorId: metalVendor.id,
      bankAccountId: bank.id,
      date: "2026-05-18",
      memo: "insured customer shipping",
      accountId: shippingExpense.id,
      amount: 65000,
    })),
    date: "2026-05-18",
    amount: 65000,
    description: "Insured customer shipping",
  });

  const budgetAccounts = [
    [jewelrySales.id, 2500000],
    [(await account("4100")).id, 125000],
    [jewelryCogs.id, 1100000],
    [rentExpense.id, 320000],
    [marketingExpense.id, 125000],
    [insuranceExpense.id, 40000],
    [shippingExpense.id, 75000],
    [operatingExpense.id, 100000],
  ];
  for (let month = 1; month <= 12; month += 1) {
    const periodStart = `2026-${String(month).padStart(2, "0")}-01`;
    await db.query(
      "select acc_save_budget_month(2026, $1::date, $2::jsonb)",
      [
        periodStart,
        JSON.stringify(
          budgetAccounts.map(([accountId, amountMinor]) => ({
            account_id: accountId,
            amount_minor: amountMinor,
          })),
        ),
      ],
    );
  }

  const bankAccount = await one("select id from acc_bank_account where account_id = $1", [
    bank.id,
  ]);
  const customerReceipts = sales.filter((sale) => sale.paymentId);
  const bankRows = [
    ...customerReceipts.map((sale) => ({
      date: sale.paymentDate,
      description: "Customer ACH deposit",
      reference: sale.paymentId,
      amount: sale.paymentAmount,
      paymentId: sale.paymentId,
    })),
    ...expenses.map((expense) => ({
      date: expense.date,
      description: expense.description,
      reference: expense.id,
      amount: -expense.amount,
      paymentId: null,
    })),
    {
      date: "2026-01-25",
      description: "Aurora Gemstone Supply vendor payment",
      reference: po1.billPaymentId,
      amount: -1200000,
      paymentId: null,
    },
    {
      date: "2026-03-20",
      description: "Heritage Precious Metals vendor payment",
      reference: po2.billPaymentId,
      amount: -904000,
      paymentId: null,
    },
  ].sort((a, b) => a.date.localeCompare(b.date));

  const batch = await one(
    `insert into acc_bank_import_batch
       (bank_account_id, filename, row_count, imported_by)
     values ($1, $2, $3, $4)
     returning id`,
    [bankAccount.id, "ctyhp-linked-jewelry-demo-2026.csv", bankRows.length, actor.user_id],
  );
  for (const [index, row] of bankRows.entries()) {
    const transaction = await one(
      `insert into acc_bank_transaction
         (bank_account_id, import_batch_id, txn_date, description, reference,
          amount_minor, raw_line, raw_hash, status)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9::acc_bank_txn_status)
       returning id`,
      [
        bankAccount.id,
        batch.id,
        row.date,
        row.description,
        row.reference,
        row.amount,
        `${row.date},${row.description},${row.amount}`,
        `${MARKER}-${String(index + 1).padStart(3, "0")}`,
        row.paymentId ? "matched" : "unmatched",
      ],
    );
    if (row.paymentId) {
      await db.query(
        `insert into acc_reconciliation
           (bank_transaction_id, payment_id, rule_applied, confidence, status, approved_by)
         values ($1, $2, 'Exact amount and near-date match', 0.995, 'approved', $3)`,
        [transaction.id, row.paymentId, actor.user_id],
      );
    }
  }

  const trial = await one(
    `select
       coalesce(sum(l.debit_minor), 0)::bigint as debit,
       coalesce(sum(l.credit_minor), 0)::bigint as credit
     from acc_journal_line l
     join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted'`,
  );
  if (Number(trial.debit) !== Number(trial.credit)) {
    throw new Error(`Trial balance is not balanced: ${trial.debit} vs ${trial.credit}`);
  }

  const itemIds = itemSetup.map(([code]) => itemByCode.get(code).id);
  const inventorySubledger = await one(
    `select
       count(*)::int as transactions,
       coalesce(sum(cost_delta_minor), 0)::bigint as value,
       min(running_qty) as minimum_running_quantity
     from acc_inventory_txn
     where item_id = any($1::uuid[])`,
    [itemIds],
  );
  const inventoryDelta = (await ledgerNet(inventory.id)) - inventoryOpening;
  if (Number(inventorySubledger.value) !== inventoryDelta) {
    throw new Error(
      `Inventory control mismatch: subledger ${inventorySubledger.value}, GL ${inventoryDelta}`,
    );
  }
  if (Number(inventorySubledger.minimum_running_quantity) < 0) {
    throw new Error("An inventory item has a negative running quantity");
  }

  const grniDelta = (await ledgerNet(grni.id)) - grniOpening;
  if (grniDelta !== -80000) {
    throw new Error(`Expected received-not-billed credit balance -80000; got ${grniDelta}`);
  }

  const summary = await one(
    `select
       (select count(*)::int from acc_purchase_order where memo like $1) as purchase_orders,
       (select count(*)::int from acc_goods_receipt where memo like $1) as receipts,
       (select count(*)::int from acc_invoice where memo like $1) as invoices,
       (select count(*)::int from acc_expense where memo like $1) as expenses,
       (select count(*)::int from acc_budget_line bl
          join acc_budget b on b.id = bl.budget_id where b.fiscal_year = 2026) as budget_lines,
       (select count(*)::int from acc_reconciliation r
          join acc_bank_transaction t on t.id = r.bank_transaction_id
         where t.raw_hash like $2 and r.status = 'approved') as bank_matches`,
    [`${MARKER}%`, `${MARKER}%`],
  );
  if (
    summary.purchase_orders !== 4 ||
    summary.receipts !== 3 ||
    summary.invoices !== 6 ||
    summary.expenses !== 8 ||
    summary.budget_lines < 96 ||
    summary.bank_matches !== customerReceipts.length
  ) {
    throw new Error(`Seed validation failed: ${JSON.stringify(summary)}`);
  }

  if (dryRun) {
    await db.query("rollback");
    console.log("Dry run passed; transaction was rolled back.");
  } else {
    await db.query("commit");
    console.log("Linked jewelry demo committed successfully.");
  }
  console.table({
    purchase_orders: summary.purchase_orders,
    goods_receipts: summary.receipts,
    invoices: summary.invoices,
    customer_payments: customerReceipts.length,
    expenses: summary.expenses,
    approved_bank_matches: summary.bank_matches,
    budget_lines: summary.budget_lines,
    inventory_transactions: Number(inventorySubledger.transactions),
    inventory_value_minor: Number(inventorySubledger.value),
    received_not_billed_credit_minor: Math.abs(grniDelta),
  });
  console.log(`Open PO: ${po4.poId}`);
  console.log(`Received-not-billed PO: ${po3.poId}`);
}

main()
  .catch(async (error) => {
    await db.query("rollback").catch(() => {});
    console.error("Seed failed and was rolled back:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
