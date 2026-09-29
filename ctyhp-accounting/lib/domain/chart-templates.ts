/**
 * The charts a new company can start from.
 *
 * Standard is the chart the migrations seed — every company has always had
 * it. Retail & Jewelry is the client's chart for retail and jewelry businesses
 * (spec 2026-09-29): every bank account in one section, inventory by kind,
 * sub-accounts under their parent, and every system account kept at the code
 * the software looks it up by. Applied inside the provisioning transaction, to
 * a company that has no postings yet.
 *
 * Pure data and SQL text. Imported by scripts/*.mjs through
 * lib/services/company-provisioning.ts, so it imports only types.
 */
import type { AccountType } from "./accounts.ts";
import type { AccountSectionKey } from "./account-sections.ts";
import type { CashFlowRole } from "./cashflow.ts";

export const CHART_TEMPLATE_KEYS = ["standard", "retail_jewelry"] as const;
export type ChartTemplateKey = (typeof CHART_TEMPLATE_KEYS)[number];

export interface TemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  section: AccountSectionKey;
  /** The parent's code, when this is a sub-account. */
  parent?: string;
  detailType?: string;
  contra?: boolean;
  /** Left as the migration set it when absent. */
  cashFlowRole?: CashFlowRole;
  /** Seeded by the migrations and looked up by its code: renamed at most, never retyped. */
  system?: boolean;
}

export interface ChartTemplate {
  key: ChartTemplateKey;
  label: string;
  description: string;
  accounts: readonly TemplateAccount[];
}

type Extra = Omit<TemplateAccount, "code" | "name" | "type" | "section">;
const at =
  (section: AccountSectionKey) =>
  (code: string, name: string, type: AccountType, extra: Extra = {}): TemplateAccount => ({ code, name, type, section, ...extra });

const bank = at("bank");
const recv = at("receivables_inventory");
const nca = at("non_current_assets");
const cl = at("current_liabilities");
const ncl = at("non_current_liabilities");
const eq = at("equity");
const inc = at("income");
const cogs = at("cogs");
const opex = at("operating_expenses");
const oexp = at("other_expenses");

const RETAIL_JEWELRY: readonly TemplateAccount[] = [
  // Current Assets – Bank Accounts
  bank("1000", "Cash on Hand", "bank", { system: true, detailType: "cash_on_hand", cashFlowRole: "cash" }),
  bank("1010", "Bank – Operating Account", "bank", { system: true, detailType: "checking", cashFlowRole: "cash" }),
  bank("1020", "Bank – Checking", "bank", { detailType: "checking", cashFlowRole: "cash" }),
  bank("1030", "Bank – Savings", "bank", { detailType: "savings", cashFlowRole: "cash" }),
  bank("1040", "Bank – Money Market", "bank", { detailType: "money_market", cashFlowRole: "cash" }),
  bank("1050", "Bank – Credit Union", "bank", { detailType: "other_bank", cashFlowRole: "cash" }),
  bank("1090", "Transfer Clearing", "current_asset", { detailType: "transfer_clearing", cashFlowRole: "cash_equivalent" }),
  bank("1210", "Undeposited Funds", "current_asset", { system: true, detailType: "undeposited_funds", cashFlowRole: "operating_asset" }),
  // Current Assets – Receivables & Inventory
  recv("1100", "Accounts Receivable", "accounts_receivable", { system: true, cashFlowRole: "operating_receivable" }),
  recv("1190", "Allowance for Doubtful Accounts", "current_asset", { system: true, contra: true }),
  recv("1200", "Inventory", "current_asset", { system: true, cashFlowRole: "operating_inventory" }),
  recv("1230", "Inventory – Jewelry", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1240", "Inventory – Finished Jewelry", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1250", "Inventory – Raw Materials", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1260", "Inventory – Retail Merchandise", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1270", "Inventory – Supplies", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1300", "Prepaid Expenses", "current_asset", { cashFlowRole: "operating_asset" }),
  recv("1390", "Other Current Assets", "current_asset", { cashFlowRole: "operating_asset" }),
  recv("2110", "Sales Tax Receivable", "current_asset", { system: true, cashFlowRole: "operating_asset" }),
  // Non-current Assets
  nca("1500", "Property & Equipment", "fixed_asset", { system: true, cashFlowRole: "investing" }),
  nca("1510", "Store Fixtures & Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1520", "Jewelry Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1530", "Computers & Office Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1540", "Vehicles", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1590", "Accumulated Depreciation", "fixed_asset", { system: true, detailType: "Contra fixed asset", contra: true, cashFlowRole: "investing" }),
  nca("1700", "Security Deposits", "fixed_asset", { cashFlowRole: "investing" }),
  nca("1790", "Other Long-Term Assets", "fixed_asset", { cashFlowRole: "investing" }),
  // Current Liabilities
  cl("2000", "Accounts Payable", "accounts_payable", { system: true, cashFlowRole: "operating_payable" }),
  cl("2050", "Credit Card Payable", "credit_card", { cashFlowRole: "financing" }),
  cl("2100", "Sales Tax Payable", "current_liability", { system: true, cashFlowRole: "operating_liability" }),
  cl("2150", "Goods Received Not Invoiced", "current_liability", { system: true, cashFlowRole: "operating_liability" }),
  cl("2200", "Customer Deposits", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2210", "Gift Cards / Store Credits Payable", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2300", "Payroll Liabilities", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2400", "Current Portion of Loans", "current_liability", { cashFlowRole: "financing" }),
  cl("2490", "Other Current Liabilities", "current_liability", { cashFlowRole: "operating_liability" }),
  // Non-current Liabilities
  ncl("2500", "Long-Term Loans Payable", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2600", "Notes Payable", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2700", "Long-Term Lease Liability", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2990", "Other Long-Term Liabilities", "long_term_liability", { cashFlowRole: "financing" }),
  // Equity
  eq("3000", "Owner's Capital / Common Stock", "equity", { system: true, cashFlowRole: "financing" }),
  eq("3100", "Additional Paid-In Capital", "equity", { cashFlowRole: "financing" }),
  eq("3200", "Retained Earnings", "equity", { cashFlowRole: "financing" }),
  eq("3300", "Owner's Draw / Distributions", "equity", { contra: true, cashFlowRole: "financing" }),
  eq("3900", "Opening Balance Equity", "equity", { system: true }),
  // Income
  inc("4000", "Sales Revenue", "income", { system: true, cashFlowRole: "operating" }),
  inc("4010", "Jewelry Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4020", "Retail Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4030", "Custom Jewelry Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4100", "Repair & Service Income", "income", { system: true, cashFlowRole: "operating" }),
  inc("4900", "Sales Returns & Allowances", "income", { contra: true, cashFlowRole: "operating" }),
  inc("4910", "Sales Discounts", "income", { contra: true, cashFlowRole: "operating" }),
  inc("7000", "Other Income", "other_income", { system: true, cashFlowRole: "operating" }),
  inc("7010", "Purchase Discounts Taken", "other_income", { system: true, cashFlowRole: "operating" }),
  inc("7990", "Gain on Asset Disposal", "other_income", { system: true }),
  // Cost of Goods Sold
  cogs("5000", "Cost of Goods Sold", "cost_of_goods_sold", { system: true, cashFlowRole: "operating" }),
  cogs("5010", "COGS – Jewelry", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5020", "COGS – Retail Merchandise", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5030", "COGS – Raw Materials", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5040", "COGS – Custom Jewelry", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5090", "Inventory Adjustments", "cost_of_goods_sold", { system: true, cashFlowRole: "operating" }),
  cogs("5100", "Freight / Shipping In", "cost_of_goods_sold", { cashFlowRole: "operating" }),
  // Operating Expenses
  opex("6000", "Operating Expenses", "expense", { system: true, cashFlowRole: "operating" }),
  opex("6010", "Salaries & Wages", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6020", "Payroll Taxes", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6030", "Rent", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6040", "Utilities", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6050", "Insurance", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6060", "Advertising & Marketing", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6070", "Merchant / Credit Card Fees", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6080", "Bank Charges", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6090", "Shipping & Delivery", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6100", "Repairs & Maintenance", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6110", "Office Supplies", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6120", "Software & Subscriptions", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6130", "Professional Fees", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6140", "Telephone & Internet", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6150", "Travel & Meals", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6160", "Taxes & Licenses", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6990", "Miscellaneous Expense", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6800", "Depreciation Expense", "expense", { system: true, cashFlowRole: "operating" }),
  opex("6900", "Bad Debt Expense", "expense", { system: true, cashFlowRole: "operating" }),
  // Other Expenses
  oexp("7500", "Other Expenses", "other_expense", { system: true, cashFlowRole: "operating" }),
  oexp("8990", "Loss on Asset Disposal", "other_expense", { system: true }),
];

export const CHART_TEMPLATES: Record<ChartTemplateKey, ChartTemplate> = {
  standard: {
    key: "standard",
    label: "Standard",
    description:
      "The starter chart every company has had: cash, bank, receivables, inventory, payables, sales tax, equity, income and expense accounts. Add your own accounts later.",
    accounts: [],
  },
  retail_jewelry: {
    key: "retail_jewelry",
    label: "Retail & Jewelry",
    description:
      "84 accounts for a jewelry or retail business: every bank account in one section, inventory by kind, fixtures and equipment, customer deposits and gift cards, long-term loans, and jewelry sales and cost of sales.",
    accounts: RETAIL_JEWELRY,
  },
};

export interface TemplateStatement {
  sql: string;
  params: unknown[];
}

const UPSERT = `
insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, detail_type, is_contra, cash_flow_role)
values ($1, $2, $3::acc_account_type, 'USD', true, $4, $5, coalesce($6::text, 'unclassified'))
on conflict (account_code) do update
   set name = excluded.name,
       detail_type = coalesce(excluded.detail_type, acc_account.detail_type),
       is_contra = excluded.is_contra or acc_account.is_contra,
       cash_flow_role = coalesce($6::text, acc_account.cash_flow_role),
       updated_at = now()`;

const SET_PARENT = `
update acc_account c
   set parent_account_id = p.id, updated_at = now()
  from acc_account p
 where c.account_code = $1 and p.account_code = $2`;

/** The SQL that turns a freshly provisioned company's chart into this template's. */
export function chartTemplateStatements(key: ChartTemplateKey): TemplateStatement[] {
  const accounts = CHART_TEMPLATES[key].accounts;
  return [
    ...accounts.map((a) => ({
      sql: UPSERT,
      params: [a.code, a.name, a.type, a.detailType ?? null, a.contra ?? false, a.cashFlowRole ?? null],
    })),
    ...accounts.filter((a) => a.parent).map((a) => ({ sql: SET_PARENT, params: [a.code, a.parent] })),
  ];
}
