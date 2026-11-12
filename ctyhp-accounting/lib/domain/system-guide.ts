/**
 * The in-app system guide: what each workflow is for, which control performs
 * each step, and where that control lives.
 *
 * Content lives here as typed data rather than prose so a test can prove every
 * route it points at exists. A guide that sends a new user to a page that was
 * renamed is worse than no guide at all.
 */

/**
 * A picture of the step, captured from the running application by
 * `scripts/capture-guide-shots.mjs`.
 *
 * Only ever captured against a sample company: a screenshot of a real screen
 * carries whatever was on it, and these books hold a customer's bank history.
 */
export interface GuideShot {
  /** Path under `public/`, so it is served without a route of its own. */
  src: string;
  /** What the picture shows, for a reader who cannot see it. */
  alt: string;
  /** One line under the image, when the picture needs pointing at. */
  caption?: string;
}

export interface GuideStep {
  /** What the user is trying to achieve, in eight words or fewer (3.0.18). */
  action: string;
  /**
   * One line on what happens, fifteen words at most: the part of the step
   * everybody reads (3.0.18). The longer explanation, when there is one, is
   * the note.
   */
  summary: string;
  /**
   * The exact on-screen label of the control that does it. "N" stands for a
   * count the screen prints in its place, as in "Remove these N entries", and
   * a closing " …" for words it fills in, as in "Adjust inventory by …".
   */
  control: string;
  /** Page the control is on. Omitted when the step happens where the flow started. */
  route?: string;
  /** The control is on every screen, as the floating Report and Ask Abacus are (3.0.18). */
  everyScreen?: boolean;
  /**
   * What the system does behind the control, or the rule that can block it.
   * Folded under Details on the guide's page; the search and Abacus read it in
   * full. Omitted when the summary already says it all.
   */
  note?: string;
  screenshot?: GuideShot;
}

/**
 * Something to settle before the first step, not while recovering from it.
 *
 * Most flows need none. A flow earns one when a step is hard to reverse — an
 * import posts three years of ledger, and a period closed afterwards puts part
 * of it beyond undo.
 */
export interface GuideCaution {
  title: string;
  body: string;
}

/**
 * Where a workflow belongs, as the sidebar groups the screens (2.51). The guide
 * lists its workflows under these headings, so a reader looking for "paying a
 * supplier" scans one short group rather than one long list.
 */
export type GuideAreaId = "sales" | "purchases" | "inventory" | "banking" | "accounting" | "data" | "controls";

export interface GuideArea {
  id: GuideAreaId;
  title: string;
  /** One line under the heading: what the group covers. */
  blurb: string;
}

/** In the order the sidebar shows them, then what sits under Settings. */
export const GUIDE_AREAS: readonly GuideArea[] = [
  { id: "sales", title: "Sales", blurb: "Quotes, invoices and the money customers pay." },
  { id: "purchases", title: "Purchases", blurb: "Purchase orders, bills and paying suppliers." },
  { id: "inventory", title: "Inventory", blurb: "What is on the shelf and what it is worth." },
  { id: "banking", title: "Banking", blurb: "Bank lines in, matched to the books, reconciled." },
  { id: "accounting", title: "Accounting & close", blurb: "Budgets, sales tax, month-end and year-end." },
  { id: "data", title: "Data & setup", blurb: "Bringing books in, and getting them back from a backup." },
  { id: "controls", title: "Controls & support", blurb: "Who may do what, and how to tell us something is wrong." },
];

export interface GuideFlow {
  id: string;
  /** The heading it is listed under (2.51). */
  area: GuideAreaId;
  title: string;
  /** Why the flow exists, in one sentence a non-accountant can follow. */
  purpose: string;
  /** Where the flow starts. */
  route: string;
  /** Read before step one. */
  cautions?: GuideCaution[];
  steps: GuideStep[];
}

import { APP_VERSION } from "./changelog";
import { versionLabel } from "./version-name";

/**
 * The product's version, not the guide's. A person saying "I am on 1.1" means
 * the whole application, so there is one number and the changelog owns it.
 */
export { APP_VERSION as GUIDE_VERSION } from "./changelog";

/**
 * About OneBook (2.51): what this build is, what it is built on, and where to
 * look when something seems wrong. Until 2.51 these said "This is version 1",
 * a first release in a test round, and that every figure was test data, which
 * stopped being true when companies began keeping their real books here. What
 * the open company's figures are is now said per company: `companyNotice`.
 */
export const GUIDE_NOTICES = [
  {
    id: "version",
    title: `You are on OneBook ${versionLabel(APP_VERSION)}`,
    body:
      "OneBook is in day-to-day use. Every release is listed under What's new with " +
      "the date it went live and the screens it changed, and the number above is " +
      "the version this browser is running. The ledger, the reports and the period " +
      "controls are checked against the double-entry rules by automated tests on " +
      "every change, before it reaches you.",
  },
  {
    id: "provenance",
    title: "Built on standard accounting practice",
    body:
      "The workflows follow established US accounting software practice, the same " +
      "ground QuickBooks covers: a double-entry ledger as the single source of " +
      "truth, documents that post to it, control accounts that reconcile, and " +
      "periods that close. Where your way of working differs, tell us through the " +
      "Report button and it becomes a tracked item.",
  },
  {
    id: "status",
    title: "If something looks broken, OneBook will tell you whether it is",
    body:
      "Open /status and it says whether OneBook itself is answering: the database, " +
      "the sign-in service and the configuration, each on its own line, with a Check " +
      "again button. It works while you are signed out and while OneBook is in " +
      "trouble, because those are the two moments you would go looking. If it says " +
      "OneBook is working and a screen still misbehaves, the problem is not with " +
      "OneBook, which is worth knowing before anybody telephones.",
  },
] as const;

/** The company whose books are open, as the guide needs it. */
export interface GuideCompany {
  name: string;
  isSample: boolean;
}

/**
 * What the figures on screen are, for the company that is open (2.51). A sample
 * company's are invented and safe to experiment on; a live company's are its
 * real books, where posting, voiding and closing change records.
 */
export function companyNotice(company: GuideCompany | null): {
  tone: "sample" | "live";
  title: string;
  body: string;
} | null {
  if (!company) return null;
  if (company.isSample) {
    return {
      tone: "sample",
      title: `${company.name} is a sample company`,
      body:
        "Its customers, vendors, invoices and balances were made up for trying " +
        "OneBook out. Post, void, reconcile or close a period freely: no figure " +
        "here belongs to a real business.",
    };
  }
  return {
    tone: "live",
    title: `These are ${company.name}'s live books`,
    body:
      "Posting, voiding, reconciling and closing a period here change real records, " +
      "and each is kept in the audit log. To try something out first, switch to a " +
      "sample company in the company list at the top of the screen.",
  };
}

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    id: "get-paid",
    area: "sales",
    title: "Invoice a customer and get paid",
    purpose:
      "Bill a customer for work, then record the money when it arrives, so the " +
      "receivable clears itself.",
    route: "/invoices",
    steps: [
      {
        action: "Create the invoice",
        summary: "Add a line per item, then Save draft. A draft posts nothing.",
        control: "New invoice",
        route: "/invoices",
        note:
          "Add a line per item or service. Totals and sales tax are calculated on " +
          "the server — a total typed by the browser is never trusted.",
        screenshot: { src: "/guide/steps/get-paid-1.webp", alt: "The New invoice button above the Invoices list, ringed in orange" },
      },
      {
        action: "Send it to the ledger",
        summary: "Press Issue on the draft's row: it gets its number and posts.",
        control: "Issue",
        note:
          "Issuing assigns the invoice number and posts the entry: debit Accounts " +
          "Receivable, credit income and sales tax. Until then it is a draft and " +
          "affects nothing.",
        screenshot: { src: "/guide/steps/get-paid-2.webp", alt: "The Issue button on a draft invoice's row in the Invoices list, ringed in orange" },
      },
      {
        action: "Give the customer a copy",
        summary: "It prints from the issued invoice; a draft prints marked DRAFT.",
        control: "Download PDF",
        note:
          "Prints from the issued document, so what the customer receives matches " +
          "what the ledger holds. A draft prints with a DRAFT watermark.",
        screenshot: { src: "/guide/steps/get-paid-3.webp", alt: "An invoice's row menu open, with Download PDF ringed in orange" },
      },
      {
        action: "Record the money received",
        summary: "Apply it to one or more open invoices of the same customer.",
        control: "Receive payment",
        route: "/payments",
        note:
          "Allocate it against one or more open invoices. The allocation cannot " +
          "exceed the open balance, and the customer and currency must match.",
        screenshot: { src: "/guide/steps/get-paid-4.webp", alt: "The Receive payment button on the Payments screen, ringed in orange" },
      },
      {
        action: "Check what is still outstanding",
        summary: "What each customer owes, by how overdue; it ties to Accounts Receivable.",
        control: "Accounts Receivable Aging",
        route: "/reports/ar-aging",
        screenshot: { src: "/guide/steps/get-paid-5.webp", alt: "The top of the Accounts Receivable Aging report, its title ringed in orange" },
      },
      {
        action: "List open invoices and customer balances",
        summary: "Both end on the A/R Aging total and say whether it agrees with receivables.",
        control: "Open Invoices",
        route: "/reports/open-invoices",
        note:
          "Customer Balances nets each customer's credits; both end with the A/R Aging total and say whether it " +
          "agrees with the receivables account. Sales by Customer adds up a period's income by customer.",
        screenshot: { src: "/guide/steps/get-paid-6.webp", alt: "The top of the Open Invoices report, its title ringed in orange" },
      },
      {
        action: "Forecast the next thirteen weeks of cash",
        summary: "Today's cash, plus what customers owe, less what you owe suppliers, week by week.",
        control: "13 Week Cash Forecast",
        route: "/reports/cash-flow-forecast",
        note:
          "It starts from the cash on hand today, then adds what customers owe and takes off what is owed to " +
          "suppliers, week by week, plus recurring templates that fall due. By due date uses the dates on the " +
          "documents; As they usually pay moves each one by how late that customer or supplier has paid before.",
        screenshot: { src: "/guide/steps/get-paid-7.webp", alt: "The top of the 13 Week Cash Forecast report, its title ringed in orange" },
      },
    ],
  },
  {
    id: "quote-a-price",
    area: "sales",
    title: "Give a customer an estimate and turn it into an invoice",
    purpose: "Promise a price before the sale, then turn it into an invoice when the customer says yes.",
    route: "/estimates",
    steps: [
      {
        action: "Write the estimate",
        summary: "Lines work as on an invoice. Save gives it a number and posts nothing.",
        control: "New estimate",
        route: "/estimates",
        note:
          "Choose the customer, the estimate date and Valid until, which starts 30 days later. The lines " +
          "work as on an invoice: an item fills in its price, income account and tax code. Save gives it " +
          "its number, EST-000001 onwards. It posts nothing.",
        screenshot: { src: "/guide/steps/quote-a-price-1.webp", alt: "The New estimate button on the Estimates screen, ringed in orange" },
      },
      {
        action: "Give the customer a copy",
        summary: "It prints as a quotation, with Valid until and nothing owed.",
        control: "Download PDF",
        note:
          "Printed on the invoice's layout with Valid until in place of the due date, and Subtotal, Sales " +
          "tax and Total with no Balance due. It always ends: This is a quotation, not an invoice. Nothing " +
          "is owed on it.",
        screenshot: { src: "/guide/steps/quote-a-price-2.webp", alt: "An estimate's row menu open, with Download PDF ringed in orange" },
      },
      {
        action: "Record a no",
        summary: "Reopen brings it back if the customer changes their mind.",
        control: "Mark declined",
        note:
          "Reopen brings it back if the customer changes their mind; a declined estimate is reopened before it " +
          "can be turned into an invoice. An estimate past its Valid until date reads Expired on its own; it " +
          "can still be edited, or turned into an invoice after a question.",
        screenshot: { src: "/guide/steps/quote-a-price-3.webp", alt: "An estimate's row menu open, with Mark declined ringed in orange" },
      },
      {
        action: "Turn a yes into an invoice",
        summary: "Opens New invoice with the customer and the lines filled in.",
        control: "Turn into an invoice",
        note:
          "Opens New invoice on the Invoices screen with the customer and lines filled in, marked From " +
          "estimate. Change anything you need first; Cancel changes nothing.",
        screenshot: { src: "/guide/steps/quote-a-price-4.webp", alt: "An estimate's row menu open, with Turn into an invoice ringed in orange" },
      },
      {
        action: "Create the draft",
        summary: "The estimate reads Converted and locks; the draft posts nothing yet.",
        control: "Save draft",
        route: "/invoices",
        note:
          "The draft is linked to the estimate, which reads Converted and is locked from then on. The draft " +
          "itself affects nothing yet: check it over before issuing it.",
        screenshot: { src: "/guide/steps/quote-a-price-5.webp", alt: "The New invoice form filled in from an estimate, with Save draft ringed in orange" },
      },
      {
        action: "Issue the invoice",
        summary: "It posts like any other invoice; the estimate itself never posts.",
        control: "Issue",
        route: "/invoices",
        screenshot: { src: "/guide/steps/quote-a-price-6.webp", alt: "A draft invoice opened from the list, with its Issue button ringed in orange" },
      },
      {
        action: "If the sale falls through after all",
        summary: "Voiding that invoice opens the estimate again, to reuse or decline.",
        control: "Void invoice",
        route: "/invoices",
        note:
          "Voiding the invoice made from an estimate opens the estimate again: it reads Open, so it can be " +
          "turned into a new invoice or marked declined. An estimate that has had an invoice made from it " +
          "cannot be deleted.",
        screenshot: { src: "/guide/steps/quote-a-price-7.webp", alt: "An invoice's row menu open, with Void invoice ringed in orange" },
      },
    ],
  },
  {
    id: "record-a-paid-sale",
    area: "sales",
    title: "Record a sale paid on the spot",
    purpose: "One sales receipt records the sale and the money at once. A sale paid later is an invoice instead.",
    route: "/sales-receipts",
    steps: [
      {
        action: "Write the receipt",
        summary: "Choose the customer; one Cash Customer can stand for every walk-in sale.",
        control: "New sales receipt",
        route: "/sales-receipts",
        note:
          "Choose the customer; for walk-in sales, add one customer such as Cash Customer once and use it for " +
          "all of them. The lines work as on an invoice: an item fills in its price, income account and tax code.",
        screenshot: { src: "/guide/steps/record-a-paid-sale-1.webp", alt: "The New sales receipt button on the Sales Receipts screen, ringed in orange" },
      },
      {
        action: "Say where the money went",
        summary: "Usually the bank account; Undeposited Funds only for takings banked together later.",
        control: "Deposit to",
        note:
          "It starts on the first bank account, so the deposit the bank later shows is matched to this receipt " +
          "in Bank Transactions. Choose 1210 Undeposited Funds only for takings that will be banked together " +
          "later. Payment method and Reference (a check number, say) are printed on the receipt.",
        screenshot: { src: "/guide/steps/record-a-paid-sale-2.webp", alt: "The Deposit to field on a new sales receipt, ringed in orange" },
      },
      {
        action: "Post it",
        summary: "It is numbered and posts at once: the deposit, the income and the tax.",
        control: "Save and post",
        note:
          "Gives it its number, SR-000001 onwards, and posts at once: the deposit account up by the total, " +
          "income by the subtotal and Sales Tax Payable by the tax. An item kept in stock also takes its cost " +
          "off the shelf, as an invoice does. A date in a closed period is refused.",
        screenshot: { src: "/guide/steps/record-a-paid-sale-3.webp", alt: "The Save and post button at the foot of a new sales receipt, ringed in orange" },
      },
      {
        action: "Give the customer a copy",
        summary: "It prints as a Sales Receipt, ending Paid in full.",
        control: "Download PDF",
        screenshot: { src: "/guide/steps/record-a-paid-sale-4.webp", alt: "A sales receipt's row menu open, with Download PDF ringed in orange" },
      },
      {
        action: "Correct a mistake",
        summary: "A receipt is never edited: void it with a reason, then enter it again.",
        control: "Void",
        note:
          "A saved receipt is never edited. Void it with the reason, which is kept with it; its entries stop " +
          "counting and any goods go back on the shelf. Then enter the sale again as a new receipt.",
        screenshot: { src: "/guide/steps/record-a-paid-sale-5.webp", alt: "A sales receipt's row menu open, with Void ringed in orange" },
      },
    ],
  },
  {
    id: "correct-a-sale",
    area: "sales",
    title: "Correct or cancel a sale",
    purpose: "Undo or reduce something already issued, without editing history.",
    route: "/invoices",
    steps: [
      {
        action: "Cancel an invoice that should not exist",
        summary: "Voiding keeps the invoice but drops it from the reports; remove payments first.",
        control: "Void invoice",
        route: "/invoices",
        note:
          "Voiding does not delete anything. The entry is marked void and drops out " +
          "of the reports, which read posted entries only. An invoice with a payment " +
          "applied must have the payment removed first.",
        screenshot: { src: "/guide/steps/correct-a-sale-1.webp", alt: "An unpaid invoice's row menu open, with Void invoice ringed in orange" },
      },
      {
        action: "Reduce what a customer owes",
        summary: "Apply it to an open invoice, or leave it as a credit for later.",
        control: "New credit memo",
        route: "/credit-memos",
        screenshot: { src: "/guide/steps/correct-a-sale-2.webp", alt: "The New credit memo button on the Credit Memos screen, ringed in orange" },
      },
      {
        action: "Give money back",
        summary: "In a payment's menu, for the part not applied to an invoice.",
        control: "Refund",
        route: "/payments",
        note:
          "In a payment's menu, when part of it is not applied to an invoice. Records the cash going out " +
          "of the bank account you choose and reduces what is left of the payment.",
        screenshot: { src: "/guide/steps/correct-a-sale-3.webp", alt: "A payment's row menu open, with Refund ringed in orange" },
      },
      {
        action: "Write off what will never be collected",
        summary: "Above the approval limit, a second person must approve it before it posts.",
        control: "Write off",
        route: "/invoices",
        screenshot: { src: "/guide/steps/correct-a-sale-4.webp", alt: "An invoice's row menu open, with Write off ringed in orange" },
      },
    ],
  },
  {
    id: "pay-suppliers",
    area: "purchases",
    title: "Record what you owe and pay it",
    purpose: "Capture supplier bills and expenses, then settle them.",
    route: "/bills",
    steps: [
      {
        action: "Enter a supplier bill",
        summary: "The same vendor and reference cannot be entered twice.",
        control: "New bill",
        route: "/bills",
        screenshot: { src: "/guide/steps/pay-suppliers-1.webp", alt: "The New bill button on the Bills screen, ringed in orange" },
      },
      {
        action: "Record a direct expense",
        summary: "Purchase tax is part of the cost; there is no separate tax line.",
        control: "New expense",
        route: "/expenses",
        screenshot: { src: "/guide/steps/pay-suppliers-2.webp", alt: "The New expense button on the Expenses screen, ringed in orange" },
      },
      {
        action: "Attach the supporting document",
        summary: "The file stays with the entry, privately, and every look at it is logged.",
        control: "Attachments",
        note:
          "The file and its checksum are kept with the transaction, privately, so the " +
          "evidence stays with the entry and every look at it is logged.",
        screenshot: { src: "/guide/steps/pay-suppliers-3.webp", alt: "The paperclip that holds a bill's attachments, ringed in orange" },
      },
      {
        action: "Pay one or many bills",
        summary: "A payment never exceeds what is open; preparing and approving can be split.",
        control: "Pay bills",
        route: "/pay-bills",
        screenshot: { src: "/guide/steps/pay-suppliers-4.webp", alt: "The Pay bills button on the Pay Bills screen, ringed in orange" },
      },
      {
        action: "See what is due",
        summary: "What each vendor is owed, by how overdue; it ties to Accounts Payable.",
        control: "Accounts Payable Aging",
        route: "/reports/ap-aging",
        screenshot: { src: "/guide/steps/pay-suppliers-5.webp", alt: "The top of the Accounts Payable Aging report, its title ringed in orange" },
      },
      {
        action: "List unpaid bills and vendor balances",
        summary: "Vendor Balances nets each vendor's credits and is checked against Accounts Payable.",
        control: "Unpaid Bills",
        route: "/reports/unpaid-bills",
        note:
          "Vendor Balances nets each vendor's credits and is held to the payables account. Expenses by Vendor " +
          "adds up a period's spending by vendor, to the Profit and Loss's cost of sales, expenses and other expenses.",
        screenshot: { src: "/guide/steps/pay-suppliers-6.webp", alt: "The top of the Unpaid Bills report, its title ringed in orange" },
      },
    ],
  },
  {
    id: "purchasing",
    area: "purchases",
    title: "Order stock and receive it",
    purpose:
      "Commit to a purchase, receive what arrives, and let the bill match both.",
    route: "/purchase-orders",
    steps: [
      {
        action: "Raise the order",
        summary: "An order commits to the purchase; it posts nothing to the books.",
        control: "New purchase order",
        route: "/purchase-orders",
        screenshot: { src: "/guide/steps/purchasing-1.webp", alt: "The New purchase order button on the Purchase Orders screen, ringed in orange" },
      },
      {
        action: "Receive what arrived",
        summary: "Partial receipts are fine; stock enters inventory only through a receipt.",
        control: "Receive",
        note:
          "Partial receipts are normal. Stock only enters inventory through a " +
          "receipt against an order, which is what keeps the inventory subledger " +
          "reconcilable.",
        screenshot: { src: "/guide/steps/purchasing-2.webp", alt: "A purchase order part received, with its Receive button ringed in orange" },
      },
      {
        action: "Match the supplier's bill",
        summary: "Makes a draft bill from what arrived; order, receipt and bill are compared.",
        control: "Create bill",
        note:
          "Three-way matching compares order, receipt and bill. A quantity or price " +
          "variance outside tolerance raises an exception instead of posting quietly.",
        screenshot: { src: "/guide/steps/purchasing-3.webp", alt: "A purchase order part received, with its Create bill button ringed in orange" },
      },
      {
        action: "Find what arrived but was never billed",
        summary: "Goods received with no vendor bill yet, so not in the ledger.",
        control: "Received Not Billed",
        route: "/purchase-orders/received-not-billed",
        screenshot: { src: "/guide/steps/purchasing-4.webp", alt: "The top of the Received Not Billed screen, its title ringed in orange" },
      },
      {
        action: "Check inventory value",
        summary: "Stock on hand, valued at weighted average cost.",
        control: "Inventory Valuation",
        route: "/reports/inventory-valuation",
        screenshot: { src: "/guide/steps/purchasing-5.webp", alt: "The top of the Inventory Valuation report, its title ringed in orange" },
      },
      {
        action: "Check purchases and that stock adds up",
        summary: "Opening stock plus purchases, less cost of sales, should come to closing stock.",
        control: "Purchases and Inventory",
        route: "/reports/purchases-inventory",
        note:
          "Year by year, Opening stock plus Net purchases plus Count adjustment, less Cost of sales, comes " +
          "to Closing stock; a year that does not is marked off by the difference. Who it was bought from and " +
          "Month by month follow the dates you pick.",
        screenshot: { src: "/guide/steps/purchasing-6.webp", alt: "The top of the Purchases and Inventory report, its title ringed in orange" },
      },
    ],
  },
  {
    id: "budget",
    area: "accounting",
    title: "Set a budget and compare it with the books",
    purpose: "Plan the year's income and spending, then see how the actual figures are tracking.",
    route: "/reports",
    steps: [
      {
        action: "Open the budget report",
        summary: "Each account shows Actual, Budget, Over / Under and % of Budget.",
        control: "Budget vs Actual",
        route: "/reports",
        note:
          "Pick the first and last period. Each line shows Actual, Budget, Over / Under and % of Budget; an " +
          "account with no budget shows a dash. A Month by month table sits under the statement.",
        screenshot: { src: "/guide/steps/budget-1.webp", alt: "Budget vs Actual chosen on the Reports screen, its title ringed in orange" },
      },
      {
        action: "Open the whole year as one grid",
        summary: "Twelve months and a Year column for each budgeted account.",
        control: "Manage budget",
        note:
          "Needs permission to manage the budget. Twelve month columns and a Year column for every account " +
          "with a budget; Add an account brings in more.",
        screenshot: { src: "/guide/steps/budget-2.webp", alt: "The Manage budget button on Budget vs Actual, ringed in orange" },
      },
      {
        action: "Fill it from the books, or by hand",
        summary: "Copy last year's actuals, add an uplift, or type a Year total to spread.",
        control: "Start from last year’s actuals",
        note:
          "Start from this year’s actuals does the same with the current year. Uplift adds a percentage on top " +
          "and may be negative. Typing a figure in a Year cell spreads it evenly over the twelve months. " +
          "Clear this year empties the grid.",
        screenshot: { src: "/guide/steps/budget-3.webp", alt: "The budget for the year, with Start from last year's actuals ringed in orange" },
      },
      {
        action: "Save the budget",
        summary: "Only the months you changed are written; a failed month is named.",
        control: "Save",
        note:
          "Nothing reaches the books until you press Save, which writes only the months you changed. If one " +
          "month fails, the others are kept and the notice names the month and the reason; Save tries the rest.",
        screenshot: { src: "/guide/steps/budget-4.webp", alt: "The budget for the year, with its Save button ringed in orange" },
      },
    ],
  },
  {
    id: "count-stock",
    area: "inventory",
    title: "Count stock",
    purpose: "Count what is on the shelves and correct the inventory on the books to it.",
    route: "/inventory/stock-count",
    steps: [
      {
        action: "Start a count",
        summary: "Dated today with the last count's lines, unless a count is still open.",
        control: "New count",
        route: "/inventory/stock-count",
        screenshot: { src: "/guide/steps/count-stock-1.webp", alt: "The New count button on the Stock Count screen, ringed in orange" },
      },
      {
        action: "Put the counted lines in",
        summary: "One line each: name, quantity and cost; Read it adds them.",
        control: "Paste a count sheet",
        note:
          "One line each: name, quantity, cost, and Sells for if you like. Press Read it to add them; a line that cannot " +
          "be read stays in the box with its line number. Add a line types one in by hand.",
        screenshot: { src: "/guide/steps/count-stock-2.webp", alt: "A draft count's Paste a count sheet box, ringed in orange" },
      },
      {
        action: "Keep the count",
        summary: "Nothing posts; Difference shows how far the books are from the count.",
        control: "Save draft",
        note:
          "Nothing reaches the books. Counted at cost, On the books and Difference show the result; change the As of " +
          "date and On the books is read again for it.",
        screenshot: { src: "/guide/steps/count-stock-3.webp", alt: "A draft count's Save draft button, ringed in orange" },
      },
      {
        action: "Correct the books to the count",
        summary: "Check the entry, then Post the adjustment; a large one needs approval.",
        control: "Adjust inventory by …",
        note:
          "Needs permission to adjust inventory, and a saved count with a difference. Choose the Inventory account and " +
          "the Offset account (a cost-of-sales account), check the entry shown, then press Post the adjustment. Above the " +
          "inventory-adjustment approval limit it is Sent for approval and posts when a second person approves it on " +
          "Approvals. Companies that track items adjust item by item instead.",
        screenshot: { src: "/guide/steps/count-stock-4.webp", alt: "A saved count's Adjust inventory by button, ringed in orange" },
      },
    ],
  },
  {
    id: "bank-lines-in",
    area: "banking",
    title: "Bring bank lines in",
    purpose: "Load a statement or a bank feed, and make sure what comes in adds up.",
    route: "/banking",
    steps: [
      {
        action: "Bring in the statement",
        summary: "PDF, CSV, OFX, QFX, QBO or QIF; a line already in is skipped.",
        control: "Import statement",
        route: "/banking",
        note:
          "A PDF, CSV, OFX, QFX, QBO or QIF file. Each line is fingerprinted, so importing the same " +
          "file twice adds nothing, and two identical lines in one file are both kept: the dialog says how " +
          "many of each set are already in Bank Transactions and how many will be imported. A line already in " +
          "Bank Transactions from another source — made from the books, from a bank feed or from another file — " +
          "is listed apart and skipped; tick it to import it as well. The same dialog imports a statement into " +
          "a reconciliation.",
      },
      {
        action: "Check that the statement adds up",
        summary: "Opening plus the lines must reach the closing balance, to the cent, before importing.",
        control: "Import statement",
        route: "/banking",
        note:
          "OneBook reads the opening and closing balances the statement prints — on a PDF, in a CSV's balance " +
          "column, an OFX ledger balance as of the file's last day, a QIF's opening balance — and shows whether " +
          "the opening plus the lines comes to the closing, to the cent, saying where the opening came from. " +
          "When it does, Import N lines is one click. When it does not, it says how much it is out by and names " +
          "the line a CSV's balance jumps after, or the one line it is out by; Import is blocked until the " +
          "statement adds up. A bank download (CSV, QFX or OFX) is read exactly; a PDF is read from its text, " +
          "and a check image or a summary table can be misread. A scanned PDF or a photo of a statement has no " +
          "text of its own: choose Read with OCR and your company's OCR server reads it, then check the lines " +
          "against the statement before importing.",
      },
      {
        action: "Make a statement add up",
        summary: "Tick a misread line, or type a balance the file does not print.",
        control: "Not a transaction",
        route: "/banking",
        note:
          "Tick Not a transaction beside a line the file was misread into: it is struck through, left out of " +
          "the count and not imported. When the file prints no opening or closing balance, type the one printed " +
          "on the statement into Opening balance printed on the statement or Closing balance printed on the " +
          "statement. When the account's last completed reconciliation closed the day before the statement " +
          "starts, its closing is taken as the opening; when the statement's first day is not known, Use $X " +
          "takes it. A balance is never taken from the books.",
      },
      {
        action: "Import a statement that does not add up",
        summary: "Administrators only, with a reason that is kept in the audit log.",
        control: "Import anyway…",
        route: "/banking",
        note:
          "For an administrator, when the statement is out and nothing in it can be corrected. It asks for a " +
          "reason and will not go on without one; the reason and the amount the statement was out by are kept " +
          "with the import and in the audit log. Everyone else reads that an administrator can import it " +
          "anyway. A statement missing a balance cannot be imported anyway, and one that does not add up is " +
          "never attached to a reconciliation.",
      },
      {
        action: "Take back a bank-feed sync",
        summary: "Under Bank feed syncs, Undo takes back the newest sync, with a reason.",
        control: "Undo",
        route: "/banking",
        note:
          "Under Bank feed syncs, Undo takes back the newest sync that changed something: the lines it added go, " +
          "and the lines it changed or removed come back as they were. Syncs are taken back newest first, and a " +
          "sync is held while a line it added is matched, coded or ignored. The next sync does not bring the lines " +
          "back; to fetch them again, disconnect the bank and connect it again. A sync that failed part-way is the " +
          "exception: the next sync fetches its changes again. Undo asks for a reason.",
      },
      {
        action: "Disconnect a bank feed",
        summary: "Removes the connection at Plaid; the lines already brought in stay.",
        control: "Disconnect",
        route: "/banking",
        note:
          "Removes the connection at Plaid, then here. The lines already in Bank Transactions stay, and the account " +
          "can be connected again. If Plaid does not confirm the removal, nothing changes unless you tick " +
          "Disconnect in OneBook only. Disconnect asks for a reason.",
      },
    ],
  },
  {
    id: "code-and-match",
    area: "banking",
    title: "Match and code bank lines",
    purpose: "Tie each bank line to its entry in the books, or post it to the right account.",
    route: "/banking",
    steps: [
      {
        action: "Match lines to the ledger",
        summary: "Approve a one-to-one suggestion in the Match column; until then nothing changes.",
        control: "Approve",
      },
      {
        action: "Code a line the books do not hold",
        summary: "Type a word and pick the account; choosing it posts the line.",
        control: "Category",
        note:
          "Type a word and the accounts that answer to it are offered, closest first — an " +
          "exact code, then your chart's own wording, then a word that means the same, so " +
          "\"wages\" finds an account called \"Payroll\". Each shows its type and whether it is " +
          "a debit or a credit account. Choosing " +
          "one posts the line: the bank on one side, that account on the other, and the line " +
          "becomes matched. A line already in the books shows the account its entry posted to " +
          "instead of asking again, and Change voids the entry and hands the line back.",
      },
      {
        action: "Recode a line from Uncategorized",
        summary: "Posts a second entry that moves the amount to the account you choose.",
        control: "Recode",
        route: "/banking",
        note:
          "In Bank Transactions, Needs coding in the posted-to filter lists the lines still in Uncategorized. Recode posts a " +
          "second entry, the same day, that moves the amount to the account you choose; the line's own entry, and " +
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead. A recoded line offers Undo recode, not Change: to code it " +
          "again, Undo recode first.",
      },
      {
        action: "Check for a charge taken twice",
        summary: "Two charges to one payee, same amount, within 30 days; you decide what to void.",
        control: "Possible duplicates",
        route: "/banking/overview",
        note:
          "The Banking overview lists two charges to the same payee, for the same amount, within 30 days — over the last " +
          "12 months — under Possible duplicates. A regular payment, such as rent or a subscription, is left alone unless one " +
          "breaks its rhythm, and a charge whose description reads differently from the payee's others comes first. Review " +
          "opens the entry; void it yourself if the bank took the money twice, since nothing is removed for you. Dismiss " +
          "asks for a reason and the pair is not offered again. A line on a completed reconciliation is never the one " +
          "offered for review.",
      },
    ],
  },
  {
    id: "cards-loans-companies",
    area: "banking",
    title: "Set up cards, loans and related companies",
    purpose: "Teach OneBook which bank lines repay a card or loan, or move money between your own companies.",
    route: "/banking/rules",
    steps: [
      {
        action: "Name your credit cards and loans",
        summary: "Add card and Add loan, with the words your bank prints for their payments.",
        control: "Add card",
        route: "/banking/rules",
        note:
          "A payment to a card is never an expense: the costs were the card's own charges. " +
          "Of a loan payment only the interest is. Add each card with Add card and each loan with " +
          "Add loan, with the words your bank prints for its payments or its last four digits, and " +
          "such a line is offered as a card or loan payment before any rule or history. A line two " +
          "entries claim gets no suggestion.",
      },
      {
        action: "Post a loan payment as principal and interest",
        summary: "Check the estimated interest against the lender's figure; the rest is principal.",
        control: "Split…",
        route: "/banking",
        note:
          "The interest offered is an estimate — the balance owed on the books × the loan's rate ÷ 12, " +
          "or its fixed amount — shown with how it was reached. Change it to the lender's figure; the " +
          "principal is what is left. One entry posts the principal to the loan, the interest to its " +
          "expense account and the payment from the bank, and Change takes it back.",
      },
      {
        action: "Tell OneBook which companies are your own",
        summary: "Money between companies the same owners run is a loan, never income or cost.",
        control: "Add related company",
        route: "/banking/rules",
        note:
          "Money sent to or received from another company the same owners run is a loan between the two, " +
          "never income or a cost. Add each with the words your bank prints for it and the one account that " +
          "carries what it owes or is owed; a line naming it, in or out, is offered to that account before any " +
          "rule or history. The table shows who owes whom today. The other company's books are not written — " +
          "record its side there.",
      },
    ],
  },
  {
    id: "reconcile-by-hand",
    area: "banking",
    title: "Reconcile an account to a statement",
    purpose: "Agree a bank account with one statement, line by line, until nothing is left to explain.",
    route: "/banking/reconcile",
    steps: [
      {
        action: "See how far each account is reconciled",
        summary: "Each account's last agreed statement, colored by its age: green, amber or red.",
        control: "Bank accounts",
        route: "/banking/reconcile",
        note:
          "Reconcile shows the chosen account's line above its reconciliations, and the Balance Sheet lists every " +
          "bank account under the sheet: the last statement agreed, its closing balance, and how many entries, and " +
          "how much, have gone in since. Green while that statement is up to 60 days old, amber after 60 days, red " +
          "after 180 and for an account never reconciled, counted to the report's date. An account never reconciled " +
          "says how many entries are waiting on a statement: start with the oldest statement you have. When an entry " +
          "ticked on a completed reconciliation is voided afterwards, the line says the reconciliation no longer " +
          "agrees, and Exceptions lists it under Reconciliations that no longer agree.",
      },
      {
        action: "Reconcile to a statement balance",
        summary: "Complete needs a difference of zero, or an adjustment somebody signs for.",
        control: "New reconciliation",
        route: "/banking/reconcile",
        note:
          "The difference is explained in its parts, and Complete needs a difference of zero or a recorded " +
          "adjustment somebody signs for. Complete then matches, in Bank Transactions, each bank line to the " +
          "book line its statement line paired with; a bank line already matched to another entry, ignored, or " +
          "of the opposite sign is left as it was, and the message says how many to check there.",
      },
      {
        action: "Read the difference",
        summary: "The difference in its parts; a line the size of what is left is named.",
        control: "Left to explain",
        route: "/banking/reconcile",
        note:
          "The difference is shown in its parts: Opening, when the reconciliation begins at a different figure " +
          "from the statement's opening; On the statement, not in the books; Ticked here, not on the statement; " +
          "and Left to explain. When exactly one line is the size of what is left, it is named: check that one " +
          "first.",
      },
      {
        action: "Set aside a misread statement line",
        summary: "Leaves it out of the difference; Restore brings it back.",
        control: "Not a transaction",
        route: "/banking/reconcile",
        note:
          "Beside a statement line the books do not have — a line the PDF was misread into. It leaves the line out " +
          "of Add missing lines and out of the difference; its line stays in Bank Transactions, to exclude there " +
          "if it is not real. Restore brings it back. A line paired with the books cannot be set aside.",
      },
      {
        action: "Add the lines the books are missing",
        summary: "Posts every listed line, dated as the bank has it, then ticks them.",
        control: "Add all N to the books",
        route: "/banking/reconcile",
        note:
          "The box above the statement lines shows each line the books do not have and the account it would " +
          "post to — by card, related company, rule or history, or else Uncategorized Income or Expense. Add all " +
          "posts every one it lists, dated as the bank has it, or none, then pairs and ticks them; Complete stays " +
          "yours. Or code them one by one in Bank Transactions and click Match again; no tick is ever removed.",
      },
      {
        action: "Add a line held back from Add all",
        summary: "A line that looks extra or already booked waits for you to add it.",
        control: "Add anyway",
        route: "/banking/reconcile",
        note:
          "Two kinds of line are held back and listed apart, each with why. When the statement already balances " +
          "without the lines the books do not have, they are marked Extra: likely not transactions. When it does " +
          "not add up and exactly one of them is the amount it is out by, that one alone is Extra. A line whose " +
          "amount the books already hold, with the same check number or within 5 days, names the entry it looks " +
          "like. Add anyway posts that one line alone, because two identical lines on one day can both be real.",
      },
      {
        action: "Start a reconciliation again",
        summary: "Removes the reconciliation and its ticks; the statement file and entries stay.",
        control: "Discard this reconciliation",
        route: "/banking/reconcile",
        note:
          "For a reconciliation in progress. It asks for a reason, removes the reconciliation, its ticks and the statement lines kept " +
          "with it, and returns to Reconcile. The statement file and its bank lines stay, and any entries added to the books " +
          "from it stay in the books. A reconciliation that posted an adjustment cannot be discarded.",
      },
      {
        action: "View the statement file",
        summary: "The statement as the bank gave it, shown inside OneBook.",
        control: "View",
        route: "/banking/reconcile",
        note:
          "Every statement OneBook reads is kept as the bank gave it, once however many reconciliations use it. " +
          "A reconciliation shows Statement file with View and Download, and its report names the file and the " +
          "first 12 characters of its SHA-256. View shows it inside OneBook — a PDF drawn page by page, a CSV as " +
          "a table, a bank download as text — without the browser ever opening the file.",
      },
      {
        action: "Attach the statement",
        summary: "For an older reconciliation with no file; it must match its figures.",
        control: "Attach the statement",
        route: "/banking/reconcile",
        note:
          "A reconciliation with no statement file — made before 1.83, or whose file could not be kept — takes " +
          "one here. The file is read in the browser and attached only if it adds up and is that reconciliation's " +
          "statement: the same closing balance and, when it kept the statement's lines, the same lines, those " +
          "ticked Not a transaction left out on both sides. Otherwise nothing " +
          "is kept and the message says what differs; the reconciliation's figures never change.",
      },
    ],
  },
  {
    id: "reconcile-from-files",
    area: "banking",
    title: "Reconcile from statement files",
    purpose: "Reconcile months at a time from PDF or CSV statements, and bring an account's history forward.",
    route: "/banking/reconcile",
    steps: [
      {
        action: "Reconcile a month or a year from files",
        summary: "Preview pairs each month with the books; Sign off signs the months that agree.",
        control: "From statement files",
        route: "/banking/reconcile",
        note:
          "Choose PDF statements, or a CSV export with a running balance column, which is cut into months. " +
          "Each closing balance comes from the file, and each statement is proved as it is read, its proof shown " +
          "under what was read. A statement that does not add up stops the run there: the statements before it " +
          "still run, and it and those after it wait — import it on its own to correct it. A month missing from " +
          "the run, or a reconciliation already in progress, stops the whole run. Preview pairs the months with the books oldest first — by date and amount, by check " +
          "number, or by amount within 5 days — up to the first that does not agree, and writes nothing. Sign off " +
          "signs the months that agree; the first that does not is started, with its pairs ticked, for you to " +
          "finish. On an account never reconciled, the earlier lines are brought forward first when the books " +
          "agree with the first statement's opening balance. Each month signed matches its bank lines in Bank " +
          "Transactions, as Complete does.",
      },
      {
        action: "Bring an account's history forward",
        summary: "When the books reach the first statement's opening exactly, earlier entries are signed off.",
        control: "Bring the history forward",
        route: "/banking/reconcile",
        note:
          "On an account never reconciled, a reconciliation that begins at a different figure from its statement's " +
          "opening checks the books up to the day before the statement. When they add up to exactly that opening, " +
          "the button appears; it asks first, saying how many entries will be marked reconciled, then signs them " +
          "off in one brought-forward reconciliation and starts this one at the statement's opening. Nothing is " +
          "posted. Otherwise it says how much the books are out by. It needs the statement file kept with the " +
          "reconciliation.",
      },
      {
        action: "See every account's unreconciled lines",
        summary: "Each account's open lines and last reconciliation; bring history forward from here too.",
        control: "Reconcile history",
        route: "/banking/reconcile/history",
        note:
          "Linked from Reconcile. Each bank account shows its lines not reconciled, their first and last dates, " +
          "when it was last reconciled with the closing balance agreed, what has gone in since, and its state. " +
          "Choose an account never reconciled and fill in Statement " +
          "balance on [date] = [amount] from one of its statements; the books on that date are read as you go. " +
          "When they match, Bring forward N entries signs them off and posts nothing; when they do not, the page " +
          "says how much they are out by. A reconciliation in progress that ends on or before the date must be " +
          "finished or discarded first.",
      },
    ],
  },
  {
    id: "check-reconciliations",
    area: "banking",
    title: "Check and correct reconciled accounts",
    purpose: "Find what makes a bank account disagree with its statements, and put it right.",
    route: "/banking/reconcile",
    steps: [
      {
        action: "Spot a balance posted as payments",
        summary: "An amber card flags payments that track the account's own balance.",
        control: "Show me the workings",
        route: "/banking/reconcile",
        note:
          "Choose the account at the top of Reconcile. When a run of entries for one payee lands exactly on what " +
          "the account itself comes to on each date, an amber card says they look like the statement's balance, " +
          "not payments: a statement's Balance column read as amounts, because a real payment does not track the " +
          "balance of the account it is paid from. Show me the workings lists each entry beside what the account " +
          "came to that day with the group taken out, and the difference; click a date to see the entry.",
      },
      {
        action: "Remove a balance posted as payments",
        summary: "With a reason, the whole group is reversed or voided; nothing is deleted.",
        control: "Remove these N entries",
        route: "/banking/reconcile",
        note:
          "Click it, give a reason, and click Confirm — remove all N. The whole group goes or none of it. An entry " +
          "posted by hand or loaded from another program is reversed on its own date; an entry coded from Bank " +
          "Transactions is voided and its bank line deleted. Nothing is deleted from the ledger, and the reason is " +
          "recorded on each reversing entry and in the audit log. Some entries cannot go from here, and the card " +
          "lists them with what to do instead: " +
          "one ticked on a completed reconciliation (reopen it first), one dated in a closed period (reopen the " +
          "period), one already reversed, or one that belongs to a document such as an invoice, bill or payment " +
          "(void the document). Needs the Post manual journals permission, and Delete bank lines when an entry " +
          "was coded from Bank Transactions.",
      },
      {
        action: "See what drags an account below zero",
        summary: "Lists the largest payments the bank has not yet shown on a statement.",
        control: "Payments not yet on a statement",
        route: "/banking/reconcile",
        note:
          "When the chosen account reads below zero today, or has dropped below zero since the last statement you " +
          "agreed, an amber card gives the figure that statement closed at, the lowest point since and the balance " +
          "today. A bank would have charged for an overdraft and printed it, so what drags the account under is " +
          "usually an entry that is not a payment — a balance posted as one, or the same thing entered twice. The " +
          "card lists the largest payments not yet on a statement; reconcile the next statement and whatever the " +
          "bank has never seen is left standing on its own. An account nobody has reconciled is flagged only while " +
          "it is below zero now.",
      },
      {
        action: "Reopen a completed reconciliation",
        summary: "Needs permission and a reason, and the reopen is audited.",
        control: "Reopen",
      },
      {
        action: "Check that signed-off reconciliations still agree",
        summary: "Lists each reconciliation that no longer agrees because an entry was voided.",
        control: "Reconciliation Report",
        route: "/reports/reconciliations",
        note:
          "A reconciliation stops agreeing when an entry it ticked is voided. The report says which ones, by how " +
          "much, and opens each.",
      },
    ],
  },
  {
    id: "period-close",
    area: "accounting",
    title: "Close an accounting period",
    purpose: "Freeze a month so its reports stop moving.",
    route: "/settings/periods",
    steps: [
      {
        action: "Check the books balance",
        summary: "Total debits must equal total credits. They always do, or the post was rejected.",
        control: "Trial Balance",
        route: "/reports",
        screenshot: { src: "/guide/steps/period-close-1.webp", alt: "The Trial Balance chosen on the Reports screen, its title ringed in orange" },
      },
      {
        action: "Read each account's month-end balance",
        summary: "Set As of to the month's last day; click a balance to see its entries.",
        control: "Chart of Accounts",
        route: "/accounts",
        note:
          "Balances, the default view, shows each account at the As of date: set it to the last day of the month. " +
          "Balance sheet accounts show what they hold on that date; income and expense accounts show the year to date. " +
          "A figure in parentheses is the wrong way round for its account. Click a name or a balance to list the entries " +
          "behind it with a running balance, then click an entry to see both sides. Setup, beside Balances, is where an " +
          "account is edited or deactivated.",
        screenshot: { src: "/guide/steps/period-close-2.webp", alt: "The As of date on the Chart of Accounts, ringed in orange" },
      },
      {
        action: "Check that clearing accounts have emptied",
        summary: "The Exception Report lists each clearing account that still holds a balance.",
        control: "Clearing accounts that have not emptied",
        route: "/reports/exceptions",
        note:
          "Mark an account as a Clearing account on its form in the Chart of Accounts — Undeposited Funds and Transfer " +
          "Clearing are marked already. The Exception Report lists each one that still holds a balance, with how many " +
          "items, the oldest, and when it last moved, counted to the report’s end date. One with no movement for more " +
          "than 60 days, or an item more than 90 days old, is Left standing: money not yet banked, or something counted " +
          "twice. The oldest items are found first in, first out.",
        screenshot: { src: "/guide/steps/period-close-3.webp", alt: "Clearing accounts that have not emptied, one of the Exception Report's checks, ringed in orange" },
      },
      {
        action: "Close the period",
        summary: "Once closed, the database refuses any posting or voiding dated in it.",
        control: "Close",
        route: "/settings/periods",
        note:
          "Needs the Close accounting periods permission, which admins hold; an admin can give it to an accountant " +
          "in Settings › Permissions. After closing, the database itself refuses to post or void into that " +
          "period — the block is not just in the interface.",
        screenshot: { src: "/guide/steps/period-close-4.webp", alt: "An open month's Close button on Accounting Periods, ringed in orange" },
      },
      {
        action: "Fix something in a closed period",
        summary: "Needs a reason and is audited; a reversal in the open period is usually better.",
        control: "Reopen",
        screenshot: { src: "/guide/steps/period-close-5.webp", alt: "A closed month's Reopen button on Accounting Periods, ringed in orange" },
      },
      {
        action: "See every close and reopen of the year",
        summary: "When, by whom, and the reason given at the time, month by month.",
        control: "Month-End Close Log",
        route: "/reports/close-log",
        screenshot: { src: "/guide/steps/period-close-6.webp", alt: "The top of the Month-End Close Log, its title ringed in orange" },
      },
      {
        action: "Compare this year's ratios with last year's",
        summary: "Fifteen ratios for liquidity, leverage and margin, with the figures behind them.",
        control: "Financial Ratios",
        route: "/reports/financial-ratios",
        note:
          "Fifteen ratios for liquidity, leverage and margin, with the figures behind them listed underneath. " +
          "A ratio with nothing to divide by is left blank.",
        screenshot: { src: "/guide/steps/period-close-7.webp", alt: "The top of the Financial Ratios report, its title ringed in orange" },
      },
      {
        action: "Take the whole ledger as one plain-text file",
        summary: "A Beancount file for bean-check and Fava, last under Accounting.",
        control: "Beancount",
        route: "/accounting/beancount",
        note:
          "Last under Accounting in the sidebar. The file is for bean-check and Fava, with a balance line per " +
          "reconciled statement.",
        screenshot: { src: "/guide/steps/period-close-8.webp", alt: "The top of the Beancount screen, its title ringed in orange" },
      },
    ],
  },
  {
    id: "sales-tax",
    area: "accounting",
    title: "Handle US sales tax",
    purpose: "Collect the right tax, then report and remit it.",
    route: "/sales-tax",
    steps: [
      {
        action: "Set up agencies and rates",
        summary: "Give each rate its effective dates; overlapping or invalid periods are rejected.",
        control: "New rate",
        route: "/sales-tax",
        screenshot: { src: "/guide/steps/sales-tax-1.webp", alt: "The New rate button on the Sales Tax screen's Tax rates tab, ringed in orange" },
      },
      {
        action: "See what is owed",
        summary: "The Liability tab reconciles to the sales tax control accounts.",
        control: "Liability",
        route: "/sales-tax",
        screenshot: { src: "/guide/steps/sales-tax-2.webp", alt: "The Liability tab on the Sales Tax screen, ringed in orange" },
      },
      {
        action: "Record a remittance",
        summary: "A filed period locks; a later correction is a linked adjustment, not an edit.",
        control: "Record payment",
        screenshot: { src: "/guide/steps/sales-tax-3.webp", alt: "The Record payment button on the Sales Tax screen, ringed in orange" },
      },
      {
        action: "See tax collected, paid and owed by period",
        summary: "Monthly, quarterly or yearly, with a proof line against the tax accounts.",
        control: "Sales Tax Liability by period",
        route: "/reports/sales-tax-liability",
        note:
          "Choose Monthly, Quarterly or Yearly. It is read from the entries, and a proof line says whether the " +
          "amount owed agrees with the tax accounts. Record a payment there opens the same dialog as above.",
        screenshot: { src: "/guide/steps/sales-tax-4.webp", alt: "The Sales Tax Liability by period link on the Sales Tax screen, ringed in orange" },
      },
    ],
  },
  {
    id: "year-end",
    area: "accounting",
    title: "Prepare vendor 1099 information",
    purpose: "Gather what a 1099 filing needs, for review by a tax professional.",
    route: "/reports/1099",
    steps: [
      {
        action: "Record vendor tax details",
        summary: "Taxpayer ID numbers are masked on screen and kept out of reports and audit records.",
        control: "Tax profile",
        route: "/vendors",
        screenshot: { src: "/guide/steps/year-end-1.webp", alt: "The Tax profile link on a vendor's row, ringed in orange" },
      },
      {
        action: "Produce the review worksheet",
        summary: "A cash-basis review worksheet, not a filing; someone qualified must check it first.",
        control: "1099 Review",
        route: "/reports/1099",
        screenshot: { src: "/guide/steps/year-end-2.webp", alt: "The top of the 1099 Review report, its title ringed in orange" },
      },
    ],
  },
  {
    id: "governance",
    area: "controls",
    title: "Control who can do what",
    purpose: "Give people the access their job needs, and no more.",
    route: "/settings/users",
    steps: [
      {
        action: "Give someone access",
        summary: "Give the least role that does the job.",
        control: "Add user",
        route: "/settings/users",
        note:
          "Add user creates a new sign-in; Add existing account gives this company to someone who already signs in " +
          "for another company you also work in. Give the least role that does the job.",
        screenshot: { src: "/guide/steps/governance-1.webp", alt: "The Add user button on the Users screen, ringed in orange" },
      },
      {
        action: "Stop someone who has left",
        summary: "Takes effect at once everywhere; repeat it in each of their companies.",
        control: "Suspend or Offboard",
        route: "/settings/users",
        note:
          "It takes effect at once on every screen, report and export. If they approved requests, check that two " +
          "people still hold Approve or reject requests; if they belonged to other companies, repeat it in each.",
        screenshot: { src: "/guide/steps/governance-2.webp", alt: "A user's row menu open, with Suspend ringed in orange" },
      },
      {
        action: "Set what each role may do",
        summary: "Each switch is checked before its action runs, so a change is immediate.",
        control: "Permissions",
        route: "/settings/permissions",
        note:
          "Each switch is checked before its action runs, so turning one off takes effect at once. Bookkeeping " +
          "actions also need the admin or accountant role, and reopening a period or a reconciliation needs an admin.",
        screenshot: { src: "/guide/steps/governance-3.webp", alt: "The top of the Permissions screen, its title ringed in orange" },
      },
      {
        action: "Require a second pair of eyes",
        summary: "Choose which actions need approval, above what amount; nobody approves their own.",
        control: "Approvals",
        route: "/settings/approvals",
        screenshot: { src: "/guide/steps/governance-4.webp", alt: "The top of the approval settings screen, its title ringed in orange" },
      },
      {
        action: "See who changed what",
        summary: "Every protected change records who did it, what, and the values before and after.",
        control: "Audit history",
        route: "/settings/audit",
        screenshot: { src: "/guide/steps/governance-5.webp", alt: "The top of the Audit history screen, its title ringed in orange" },
      },
      {
        action: "Review changes, voids and reversals",
        summary: "The Change Log reads the audit log; nothing in OneBook is deleted.",
        control: "Change Log",
        route: "/reports/change-log",
        note:
          "The Change Log reads the audit log and needs the same permission. Voided and Reversed Entries lists " +
          "every entry voided or reversed in a period; nothing in OneBook is deleted.",
        screenshot: { src: "/guide/steps/governance-6.webp", alt: "The top of the Change Log report, its title ringed in orange" },
      },
      {
        action: "Review access every quarter",
        summary: "Confirm each role is still needed, suspend leavers, and note who reviewed.",
        control: "Users",
        route: "/settings/users",
        note:
          "Confirm each active person still needs their role, suspend anyone who has left, check any change to " +
          "Permissions is still wanted, read Audit history for users and permissions since the last review, and " +
          "note the date and who reviewed.",
        screenshot: { src: "/guide/steps/governance-7.webp", alt: "The top of the Users screen, its title ringed in orange" },
      },
    ],
  },
  {
    id: "set-up-a-company",
    area: "data",
    title: "Set up a new company",
    purpose: "A new company starts with only a chart of accounts. Settings › Company ticks off what it still needs.",
    route: "/settings/companies",
    steps: [
      {
        action: "Create the company",
        summary: "Platform administrators only; pick a starting chart, then choose the company at the top.",
        control: "New company",
        route: "/settings/companies",
        note:
          "Only a platform administrator sees it. Choose the chart of accounts to start from; building the books takes "
          + "about half a minute, and you are the company's first administrator. Then choose it in the company list "
          + "at the top.",
        screenshot: { src: "/guide/steps/set-up-a-company-1.webp", alt: "The New company button on the Companies screen, ringed in orange" },
      },
      {
        action: "Fill in the company's details",
        summary: "Name, address, phone and email for documents, the time zone and fiscal year.",
        control: "Edit",
        route: "/settings/company",
        note:
          "Setting up this company, at the top of Settings › Company, shows the four steps and how far each is. Edit "
          + "saves the legal name, the address, phone and email that invoices, estimates and sales receipts print, the "
          + "time zone every date is read in and the month the fiscal year starts. Each save is a new version.",
        screenshot: { src: "/guide/steps/set-up-a-company-2.webp", alt: "The Edit button on the company's details, ringed in orange" },
      },
      {
        action: "Choose where new documents land",
        summary: "Posting defaults set the accounts a new form starts on.",
        control: "Edit",
        route: "/settings/company",
        note:
          "On Posting defaults, under the company's details: where money in lands, where money out comes from, and "
          + "the income and expense accounts a line starts on. They only fill a form; a saved document keeps its own "
          + "accounts.",
        screenshot: { src: "/guide/steps/set-up-a-company-3.webp", alt: "The Edit button on Posting defaults, ringed in orange" },
      },
      {
        action: "Enter where the books start",
        summary: "What each account held on day one; skip it if starting from nothing.",
        control: "Post opening balances",
        route: "/opening-balances",
        note:
          "What each account held on the day the books start in OneBook. A business that starts with nothing can skip "
          + "this; books brought in from another system usually carry their balances in their first entries instead.",
        screenshot: { src: "/guide/steps/set-up-a-company-4.webp", alt: "The Post opening balances button, ringed in orange" },
      },
      {
        action: "Add the bank and card accounts",
        summary: "Each links a ledger account to the statements reconciled against it.",
        control: "Add bank account",
        route: "/banking",
        screenshot: { src: "/guide/steps/set-up-a-company-5.webp", alt: "The Add bank account button on Bank Transactions, ringed in orange" },
      },
      {
        action: "Add the people who work in the books",
        summary: "Someone already in OneBook for another company: Add existing account.",
        control: "Add user",
        route: "/settings/users",
        screenshot: { src: "/guide/steps/set-up-a-company-6.webp", alt: "Add user on the Users screen, where the people who keep the books are added, ringed in orange" },
      },
    ],
  },
  {
    id: "restore-a-backup",
    area: "data",
    title: "Find a backup, and open it as a second company to compare against",
    purpose: "Your books are copied on a schedule. Open an earlier copy as a separate company and compare.",
    route: "/settings/backups",
    cautions: [
      {
        title: "A snapshot does not include your attachments",
        body:
          "It holds every table in the books — accounts, entries, invoices, bills, customers, "
          + "vendors, vendor tax profiles. It does not hold the files: document scans, bill "
          + "attachments and feedback images live in storage and are not copied. The snapshot "
          + "lists them, so you can tell what was attached, but restoring will not bring the "
          + "files themselves back.",
      },
      {
        title: "The restored copy holds taxpayer identification numbers",
        body:
          "Vendor tax profiles come across with everything else. The copy is a company like any "
          + "other, so anybody you later give access to it can see them. Restore when you need "
          + "to, and delete the copy once the comparison is done.",
      },
      {
        title: "The people are not copied, only the books",
        body:
          "You are the restored company's only user. Nobody else gains access to a set of books "
          + "just because a copy of them was made.",
      },
    ],
    steps: [
      {
        action: "Find the day to go back to",
        summary: "One row per snapshot, newest first; only a Stored row can be restored.",
        control: "Backups",
        route: "/settings/backups",
        note:
          "One row per snapshot, newest first. A row saying Skipped means the books had not "
          + "changed since the previous snapshot, so that day's figures are the ones in the row "
          + "above it. Only a Stored row can be downloaded or restored.",
        screenshot: { src: "/guide/steps/restore-a-backup-1.webp", alt: "The top of the Backups screen, its title ringed in orange" },
      },
      {
        action: "Take a copy of the file for yourself",
        summary: "A ZIP of one CSV per table, with its totals; the link lasts five minutes.",
        control: "Download",
        note:
          "A single ZIP holding one CSV per table, plus a manifest listing the row counts and "
          + "the totals recorded when it was taken — the same file Company settings' Export "
          + "button produces. The link is good for five minutes.",
        screenshot: { src: "/guide/steps/restore-a-backup-2.webp", alt: "A snapshot's Download button on the Backups screen, ringed in orange" },
      },
      {
        action: "Open that day's books as a separate company",
        summary: "Name the new company and confirm; the company you work in is untouched.",
        control: "Restore",
        note:
          "Opens a page to name the new company. Confirm with Restore into a new company: it "
          + "creates the company and loads the snapshot into it. The company you are working in "
          + "is not touched, and cannot be — no part of this writes back to it.",
        screenshot: { src: "/guide/steps/restore-a-backup-3.webp", alt: "A snapshot's Restore button on the Backups screen, ringed in orange" },
      },
      {
        action: "Check the copy came back whole",
        summary: "The restored totals are compared with the snapshot's; a mismatch names the figure.",
        control: "Control totals",
        note:
          "After loading, the trial balance, the receivable and payable totals and the journal "
          + "line count are recalculated from the restored books and compared with the ones "
          + "recorded in the snapshot. A match is the evidence the copy is faithful. A mismatch "
          + "names the figure and both values rather than failing quietly. A snapshot taken "
          + "before some kinds of record were backed up (before November 11, 2026) lists those "
          + "kinds under the verdict: they come back empty, and the totals do not cover them.",
        screenshot: { src: "/guide/steps/restore-a-backup-4.webp", alt: "The note on the restore page that the control totals are checked when it finishes, ringed in orange" },
      },
      {
        action: "Read the two side by side",
        summary: "Open the same report in each company; the balance sheet shows what moved.",
        control: "The company switcher",
        note:
          "Switch between the restored copy and the running books and open the same report on "
          + "each. Comparing a balance sheet on both is the fastest way to see which account "
          + "moved and by how much.",
        screenshot: { src: "/guide/steps/restore-a-backup-5.webp", alt: "The company list at the top of the screen, ringed in orange" },
      },
    ],
  },
  {
    id: "import-transactions",
    area: "data",
    title: "Bring across a list of transactions you have already categorized",
    purpose: "Load an export where each row names its bank and its account, so every row posts as it stands.",
    route: "/settings/import",
    cautions: [
      {
        title: "One row per transaction, not a general ledger",
        body:
          "A general ledger has one row per side of a transaction, grouped under each account. This tab " +
          "wants the other shape: one row per transaction, naming both the bank and the chart-of-account. " +
          "If the file is grouped into sections per account, use the General ledger tab instead.\n\nRows " +
          "carrying no money are left out, and that is not a fault. A waived fee is often written as 0.00. " +
          "There is nothing to post for those rows. They are counted on their own, apart from rows that " +
          "really do have a problem.",
      },
      {
        title: "Every account and bank in the file must already exist",
        body:
          "Every account the file names must already be in the chart of accounts. A transaction row never " +
          "creates an account — the same name means different things in two charts, and a typo would become " +
          "a permanent account. The screen lists every name it cannot find and keeps the button shut until " +
          "each one is answered. Answering it does not mean editing the file: point the name at an account " +
          "you already have, or create it there with the type you choose.\n\nA name two accounts answer to is " +
          "refused, and the account code is the way out. An imported chart can easily hold both \"1000 Cash " +
          "on Hand\" and \"140 Cash on Hand\". A row naming only \"Cash on Hand\" is then a question, not a " +
          "reference — one of those is a bank and the other is not — so nothing is imported under it. Two " +
          "ways to answer it. Put the code in the file: either \"1000\" on its own, or \"1000 - Cash on Hand\" " +
          "with the spaced hyphen; \"1000 Cash on Hand\" without the hyphen is not a form the chart " +
          "recognizes. Or, when the file is somebody else's export and cannot be edited, set the account " +
          "you do not use to Inactive in Chart of Accounts, under Setup — one live account of that name is " +
          "no longer a question.\n\nThe bank accounts have to exist under Banking, not only in the chart. " +
          "Each row also writes a bank line, and that line is what stops a second import of the same file " +
          "posting the same money twice. An account that is not of a bank or credit card type cannot be " +
          "added there at all — point those rows at the account the money really moved through.",
      },
      {
        title: "Every import is recorded, and can be undone",
        body:
          "The list under the preview shows what has been imported: the file, how many rows, over what " +
          "dates, by whom. Undo voids the entries it posted and removes its bank lines, which is what frees " +
          "the file to be imported again once it is corrected. Loading the very same file while its import " +
          "is still live is refused rather than skipped in silence — rows from a *different* file that " +
          "overlap are still recognized and skipped.",
      },
    ],
    steps: [
      {
        action: "Open the Transactions tab in the right company",
        summary: "Everything posts into the company open in the switcher at the top.",
        control: "Transactions",
        route: "/settings/import",
        note:
          "Everything posts into whichever company is open in the switcher. The panel at the top " +
          "of the tab names what has to exist before the file will go in — and once a file is " +
          "chosen, a second panel checks it against this company straight away: which account " +
          "names cannot be found, and which banks have no record. Both can be answered there, " +
          "by pointing a name at an account you already have or by creating what is missing.",
        screenshot: {
          src: "/guide/txn-01-before.png",
          alt: "The Before you start panel on the transactions tab, listing the chart of accounts and Banking as prerequisites",
          caption: "Read this before choosing a file, not after mapping every column.",
        },
      },
      {
        action: "See what this company is missing",
        summary: "Choosing the file checks every account and bank against this company at once.",
        control: "What this file needs",
        note:
          "Choosing the file is enough for this: the screen checks every account name and every " +
          "bank in it against this company straight away. A name the chart does not have can be " +
          "pointed at an account that does exist — which is what a file somebody else exported " +
          "usually needs, since you cannot edit it — or created here, with the type chosen by " +
          "you. A bank with no record can be declared without leaving the screen.",
        screenshot: {
          src: "/guide/txn-02-preflight.png",
          alt: "The panel listing account names the chart cannot find, each with a picker to choose the account it means",
          caption: "Answered here, rather than on two other screens after mapping seven columns.",
        },
      },
      {
        action: "Choose the file and check the columns",
        summary: "Columns are matched from the file's headings; Date and Chart of account are required.",
        control: "Choose a CSV file",
        note:
          "The columns are matched from the file's own headings and can all be changed. Date and " +
          "Chart of account are required. Money is either a signed Amount — positive is money " +
          "into the bank — or a Debit and Credit pair; map one or the other.",
        screenshot: {
          src: "/guide/txn-03-columns.png",
          alt: "The column mapping table with Date, Description, Bank account, Chart of account and Amount matched to the file's headings",
          caption: "Leave Bank account unmapped to post every row to one account chosen above.",
        },
      },
      {
        action: "See what will happen before anything happens",
        summary: "Counts what will be created, what has a problem and what carries no money.",
        control: "See what will happen",
        note:
          "How many rows will be created, how many have a genuine problem, how many carry no " +
          "money, and the net of the transactions — which is a net, not an opening balance.",
        screenshot: {
          src: "/guide/txn-04-preview.png",
          alt: "The figures above the preview: rows to create, rows with problems, rows carrying no money, and the net",
          caption: "Check the net against the report you exported before importing.",
        },
      },
      {
        action: "Read anything the screen refuses to import",
        summary: "Each refusal says exactly what to fix; none is worth working around.",
        control: "The panels below the preview",
        note:
          "An account the chart does not have, a bank account Banking has not seen, and a name " +
          "that belongs to two accounts at once each say exactly what to do. None is worth " +
          "working around: the import posts real money.",
        screenshot: {
          src: "/guide/txn-05-empty.png",
          alt: "The note explaining that rows carrying no money are left out and need no fixing",
          caption: "A row worth 0.00 is left out quietly. Only real problems are red.",
        },
      },
      {
        action: "Import, then check the bank",
        summary: "Each row posts one entry and one bank line, already matched in Bank Transactions.",
        control: "Import",
        note:
          "Each row posts one journal entry and one bank line already marked matched, so " +
          "connecting a bank feed for the same account later cannot count the same money twice.",
        screenshot: {
          src: "/guide/txn-04-preview.png",
          alt: "The same figures, which are what the import will have posted once it finishes",
          caption: "What the preview counted is what the import posts.",
        },
      },
      {
        action: "Check it landed, and keep the way back",
        summary: "Listed under the preview; Undo voids it so a corrected file can go in.",
        control: "Undo",
        route: "/settings/import",
        note:
          "The import now appears in the list under the preview, with its file name, row count " +
          "and dates. Undo is how a mistaken import is put right: it voids the entries and " +
          "removes the bank lines, leaving the corrected file free to be imported in their place.",
        screenshot: {
          src: "/guide/txn-06-record.png",
          alt: "The register of imports, showing the file, its dates and row count, with an Undo button",
          caption: "Undo voids the entries and removes the bank lines it posted.",
        },
      },
    ],
  },
  {
    id: "import-a-ledger",
    area: "data",
    title: "Bring a company's books across from QuickBooks or Wave",
    purpose:
      "Load a general ledger exported from another product so its accounts, its " +
      "history and its balances live in OneBook.",
    route: "/settings/import",
    cautions: [
      {
        title: "Check which company you are in, and try a sample first",
        body:
          "An import posts into the company open in the switcher at the top of the screen, and it says " +
          "which one on the button before you press it. There is no way to move an import from one company " +
          "to another afterwards.\n\nTry it on a sample company before the real books. A sample company can " +
          "be thrown away. Load the file there first, read the Trial Balance, and only then do it for real.",
      },
      {
        title: "The chart of accounts must already hold every account the file names",
        body:
          "A ledger row never creates an account: the same name means different things in two charts, and a " +
          "typo would become a permanent account. The screen lists every name it cannot find and keeps the " +
          "button shut until each one is answered — and it is answered there, not on another screen: point " +
          "the name at an account you already have, or create it with the type you choose. A name two live " +
          "accounts answer to counts as one it cannot find, and the same picker settles that.",
      },
      {
        title: "A file imports once, and Undo needs the period open",
        body:
          "Undo works only while the period is still open. An import can be undone from the list at the " +
          "bottom of the tab, which voids every entry it created. An entry dated in a closed period cannot " +
          "be voided at all — the refusal says so in those words — so a mistake there has to be corrected " +
          "with a reversing entry instead. Do not close a period until you have checked the import against " +
          "the report you exported.\n\nThe same file cannot be imported twice. OneBook remembers the file, " +
          "not the file name, so a second attempt is refused even if you rename it or pick the other mode. " +
          "That is deliberate: a doubled ledger balances perfectly and looks entirely correct.",
      },
    ],
    steps: [
      {
        action: "Open the company these books belong to",
        summary: "Everything posts into the company open here; the Import button repeats its name.",
        control: "The company switcher",
        route: "/settings/import",
        screenshot: {
          src: "/guide/import-01-tab.png",
          alt: "The import screen with the General ledger tab selected among the other import tabs",
          caption: "The tab strip. A general ledger has its own tab because it needs no column mapping.",
        },
      },
      {
        action: "Choose the General ledger tab",
        summary: "Each row is one side of an entry, so there are no columns to match.",
        control: "General ledger",
        note:
          "The other tabs read one row per record and ask you to match columns. A " +
          "general ledger is different: every row is one side of a double entry, and " +
          "what it means comes from the account section it sits under, so there is " +
          "nothing to match.",
        screenshot: {
          src: "/guide/import-02-empty.png",
          alt: "The General ledger tab before a file is chosen, showing the drop area",
          caption: "Drop the export here. Nothing is sent until you press Import.",
        },
      },
      {
        action: "Drop the exported file in",
        summary: "Check its accounts, lines and total debits against the export's own totals.",
        control: "Drop the Account Transactions export here",
        note:
          "The file is read in your browser. The screen then shows how many accounts, " +
          "dates and lines it found, and the total debits — check those against the " +
          "totals printed at the bottom of the export before going on.",
        screenshot: {
          src: "/guide/import-03-preview.png",
          alt: "The preview showing account count, entry count, line count, total debits and the per-account table",
          caption: "Every account in the file, with its own debits and credits.",
        },
      },
      {
        action: "Read anything the screen refuses to import",
        summary: "A missing account, an unbalanced date or a totals mismatch stops the import.",
        control: "The red panels",
        note:
          "Three things stop an import before it starts: an account the chart does " +
          "not have, a date whose debits and credits differ, and a disagreement " +
          "between OneBook's totals and the file's own. Each names exactly what is " +
          "wrong. None of them is worth working around.",
        screenshot: {
          src: "/guide/import-04-blocked.png",
          alt: "A table of the names in the file the chart cannot find, each with a picker to choose the account it means",
          caption: "Point each name at an account you already have, or create it here.",
        },
      },
      {
        action: "Choose how much to bring across",
        summary: "The whole history keeps every transaction; Closing balances only posts one entry.",
        control: "The whole history / Closing balances only",
        note:
          "The whole history posts one journal entry per date, so every transaction " +
          "stays searchable in the General Ledger report. Closing balances only posts " +
          "a single entry with each account's net, dated as of the day you choose — " +
          "smaller and safer, but the detail is gone. Either way the original file is " +
          "kept under Reports.",
        screenshot: {
          src: "/guide/import-05-mode.png",
          alt: "The two import modes with the whole history selected and the import button beneath",
          caption: "The button counts what it is about to post.",
        },
      },
      {
        action: "Import, then check the result",
        summary: "It all posts or none of it does; the file is kept under Reports.",
        control: "Import",
        note:
          "Everything posts in one go: if any part of it fails, none of it lands. " +
          "Afterwards, read the Trial Balance and compare it with the report you " +
          "exported. The file itself is saved under Reports → Saved Reports.",
        screenshot: {
          src: "/guide/import-06-batches.png",
          alt: "The list of ledgers imported before, each row offering an Undo button",
          caption: "Every import is listed here, and Undo voids the entries it created.",
        },
      },
      {
        action: "Check the numbers against the source",
        summary: "OneBook's trial balance should match the closing balances you exported.",
        control: "Trial Balance",
        route: "/reports",
        note:
          "The one check worth doing every time: the trial balance in OneBook should " +
          "match the closing balances on the report you exported. If it does not, undo " +
          "the import while the period is still open.",
        screenshot: {
          src: "/guide/import-07-saved.png",
          alt: "The Saved Reports screen listing the imported file, kept as it arrived",
          caption: "The original export, kept so the ledger can be checked against its source.",
        },
      },
    ],
  },
  {
    id: "feedback",
    area: "controls",
    title: "Tell us what is wrong or missing",
    purpose: "Turn what you notice into a tracked item, and follow what happens to it.",
    route: "/settings/feedback",
    steps: [
      {
        action: "Report a problem or suggest an improvement",
        summary: "The Report button, bottom right of every page, can attach a screenshot.",
        control: "Report",
        everyScreen: true,
        note:
          "The floating Report button works on every page. It captures a screenshot " +
          "of what you are looking at — you can send the report without it.",
        screenshot: { src: "/guide/steps/feedback-1.webp", alt: "The Report button at the bottom right of the screen, ringed in orange" },
      },
      {
        action: "Ask how something is meant to work",
        summary: "Answers come from these guides; the assistant cannot see your figures.",
        control: "Ask Abacus",
        everyScreen: true,
        screenshot: { src: "/guide/steps/feedback-2.webp", alt: "The Ask Abacus button at the bottom right of the screen, ringed in orange" },
      },
      {
        action: "Follow what happens to a report",
        summary: "Reports move through New, Reviewing, Resolved and Declined.",
        control: "Feedback triage",
        route: "/settings/feedback",
        screenshot: { src: "/guide/steps/feedback-3.webp", alt: "The top of the Feedback triage screen, its title ringed in orange" },
      },
    ],
  },
];

/** Every route the guide links to, for the test that proves they all exist. */
export function guideRoutes(): string[] {
  const routes = new Set<string>();
  for (const flow of GUIDE_FLOWS) {
    routes.add(flow.route);
    for (const step of flow.steps) if (step.route) routes.add(step.route);
  }
  return [...routes].sort();
}
