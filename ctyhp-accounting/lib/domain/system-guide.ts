/**
 * The in-app system guide: what each workflow is for, which control performs
 * each step, and where that control lives.
 *
 * Content lives here as typed data rather than prose so a test can prove every
 * route it points at exists. A guide that sends a new user to a page that was
 * renamed is worse than no guide at all.
 */

export interface GuideStep {
  /** What the user is trying to achieve. */
  action: string;
  /** The exact on-screen label of the control that does it. */
  control: string;
  /** Page the control is on. Omitted when the step happens where the flow started. */
  route?: string;
  /** What the system does behind the control, or the rule that can block it. */
  note?: string;
}

export interface GuideFlow {
  id: string;
  title: string;
  /** Why the flow exists, in one sentence a non-accountant can follow. */
  purpose: string;
  /** Where the flow starts. */
  route: string;
  steps: GuideStep[];
}

export const GUIDE_VERSION = "1.0";

/** Shown before any workflow: what this build is and is not. */
export const GUIDE_NOTICES = [
  {
    id: "version",
    title: "This is version 1",
    body:
      "Every accounting module is in place and covered by automated tests, but this " +
      "is a first release. Expect rough edges in wording and layout rather than in " +
      "the numbers: the ledger, the reports and the period controls are verified " +
      "against the double-entry rules on every change.",
  },
  {
    id: "test-data",
    title: "The data you see is test data",
    body:
      "Customers, vendors, invoices, bills and balances in this environment were " +
      "created for testing. Nothing here is a real transaction, so explore freely — " +
      "post, void, reconcile, close a period. Do not treat any figure on screen as " +
      "an actual company balance.",
  },
  {
    id: "provenance",
    title: "Built from standard accounting practice, to be tuned to yours",
    body:
      "The workflows follow established US accounting software practice — the same " +
      "ground QuickBooks covers: a double-entry ledger as the single source of " +
      "truth, documents that post to it, control accounts that reconcile, and " +
      "periods that close. Where your way of working differs, that is a change we " +
      "make after this test round: tell us through the Report button and it becomes " +
      "a tracked item.",
  },
] as const;

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    id: "get-paid",
    title: "Invoice a customer and get paid",
    purpose:
      "Bill a customer for work, then record the money when it arrives, so the " +
      "receivable clears itself.",
    route: "/invoices",
    steps: [
      {
        action: "Create the invoice",
        control: "New invoice",
        route: "/invoices",
        note:
          "Add a line per item or service. Totals and sales tax are calculated on " +
          "the server — a total typed by the browser is never trusted.",
      },
      {
        action: "Send it to the ledger",
        control: "Issue",
        note:
          "Issuing assigns the invoice number and posts the entry: debit Accounts " +
          "Receivable, credit income and sales tax. Until then it is a draft and " +
          "affects nothing.",
      },
      {
        action: "Give the customer a copy",
        control: "Download PDF",
        note:
          "Prints from the issued document, so what the customer receives matches " +
          "what the ledger holds. A draft prints with a DRAFT watermark.",
      },
      {
        action: "Record the money received",
        control: "New payment",
        route: "/payments",
        note:
          "Allocate it against one or more open invoices. The allocation cannot " +
          "exceed the open balance, and the customer and currency must match.",
      },
      {
        action: "Check what is still outstanding",
        control: "AR aging",
        route: "/reports/ar-aging",
        note: "This report ties to the Accounts Receivable control account by design.",
      },
    ],
  },
  {
    id: "correct-a-sale",
    title: "Correct or cancel a sale",
    purpose: "Undo or reduce something already issued, without editing history.",
    route: "/invoices",
    steps: [
      {
        action: "Cancel an invoice that should not exist",
        control: "Void",
        route: "/invoices",
        note:
          "Voiding does not delete anything. The entry is marked void and drops out " +
          "of the reports, which read posted entries only. An invoice with a payment " +
          "applied must have the payment removed first.",
      },
      {
        action: "Reduce what a customer owes",
        control: "New credit memo",
        route: "/credit-memos",
        note: "Apply it to an open invoice, or leave it as a credit for later.",
      },
      {
        action: "Give money back",
        control: "New refund",
        route: "/credit-memos",
        note: "Records the cash going out and clears the credit it came from.",
      },
      {
        action: "Write off what will never be collected",
        control: "Write off",
        route: "/invoices",
        note:
          "A write-off is a controlled action: above the configured threshold it " +
          "needs a second person's approval before it posts.",
      },
    ],
  },
  {
    id: "pay-suppliers",
    title: "Record what you owe and pay it",
    purpose: "Capture supplier bills and expenses, then settle them.",
    route: "/bills",
    steps: [
      {
        action: "Enter a supplier bill",
        control: "New bill",
        route: "/bills",
        note:
          "Duplicate vendor-and-reference combinations are detected, so the same " +
          "invoice cannot be entered twice by two people.",
      },
      {
        action: "Record a direct expense",
        control: "New expense",
        route: "/expenses",
        note:
          "For US reporting, purchase-side tax is part of the cost — there is no " +
          "separate recoverable tax line.",
      },
      {
        action: "Attach the supporting document",
        control: "Attachments",
        note:
          "The file, its checksum and the malware-scan result are recorded with the " +
          "transaction, so the evidence stays with the entry.",
      },
      {
        action: "Pay one or many bills",
        control: "Pay bills",
        route: "/pay-bills",
        note:
          "A payment can never exceed the eligible open balance, and preparing a " +
          "payment can be separated from approving it.",
      },
      {
        action: "See what is due",
        control: "AP aging",
        route: "/reports/ap-aging",
        note: "Ties to the Accounts Payable control account.",
      },
    ],
  },
  {
    id: "purchasing",
    title: "Order stock and receive it",
    purpose:
      "Commit to a purchase, receive what arrives, and let the bill match both.",
    route: "/purchase-orders",
    steps: [
      {
        action: "Raise the order",
        control: "New purchase order",
        route: "/purchase-orders",
      },
      {
        action: "Receive what arrived",
        control: "Receive",
        note:
          "Partial receipts are normal. Stock only enters inventory through a " +
          "receipt against an order, which is what keeps the inventory subledger " +
          "reconcilable.",
      },
      {
        action: "Match the supplier's bill",
        control: "Convert to bill",
        note:
          "Three-way matching compares order, receipt and bill. A quantity or price " +
          "variance outside tolerance raises an exception instead of posting quietly.",
      },
      {
        action: "Find what arrived but was never billed",
        control: "Received not billed",
        route: "/purchase-orders/received-not-billed",
      },
      {
        action: "Check inventory value",
        control: "Inventory valuation",
        route: "/reports/inventory-valuation",
        note: "Valued at weighted average cost.",
      },
    ],
  },
  {
    id: "banking",
    title: "Match the bank and reconcile",
    purpose:
      "Prove that what the ledger says about cash agrees with what the bank says.",
    route: "/banking",
    steps: [
      {
        action: "Bring in the statement",
        control: "Import statement",
        route: "/banking",
        note:
          "Each line is fingerprinted, so importing the same file twice adds " +
          "nothing and two genuinely different lines are never merged.",
      },
      {
        action: "Match lines to the ledger",
        control: "Suggest matches",
        note: "Suggestions are one-to-one and need approval before they take effect.",
      },
      {
        action: "Reconcile to a statement balance",
        control: "New reconciliation",
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for.",
      },
      {
        action: "Reopen a completed reconciliation",
        control: "Reopen",
        note: "Needs permission and a reason, and the reopen is audited.",
      },
    ],
  },
  {
    id: "period-close",
    title: "Close an accounting period",
    purpose: "Freeze a month so its reports stop moving.",
    route: "/settings/periods",
    steps: [
      {
        action: "Check the books balance",
        control: "Trial Balance",
        route: "/reports",
        note: "Total debits must equal total credits. They always do, or the post was rejected.",
      },
      {
        action: "Close the period",
        control: "Close period",
        route: "/settings/periods",
        note:
          "After closing, the database itself refuses to post or void into that " +
          "period — the block is not just in the interface.",
      },
      {
        action: "Fix something in a closed period",
        control: "Reopen period",
        note:
          "Reopening needs a reason and is audited. The accounting-correct route is " +
          "usually a reversal in the open period rather than a reopen.",
      },
    ],
  },
  {
    id: "sales-tax",
    title: "Handle US sales tax",
    purpose: "Collect the right tax, then report and remit it.",
    route: "/sales-tax",
    steps: [
      {
        action: "Set up agencies and rates",
        control: "New tax code",
        route: "/sales-tax",
        note: "Overlapping or invalid effective periods are rejected.",
      },
      {
        action: "See what is owed",
        control: "Sales tax liability",
        route: "/sales-tax",
        note: "Reconciles to the sales-tax control accounts.",
      },
      {
        action: "Record a remittance",
        control: "Record payment",
        note:
          "A filed period is locked; a later correction becomes a linked adjustment " +
          "rather than an edit.",
      },
    ],
  },
  {
    id: "year-end",
    title: "Prepare vendor 1099 information",
    purpose: "Gather what a 1099 filing needs, for review by a tax professional.",
    route: "/reports/1099",
    steps: [
      {
        action: "Record vendor tax details",
        control: "Tax profile",
        route: "/vendors",
        note:
          "Taxpayer identification numbers are masked on screen and never written " +
          "into audit payloads or reports.",
      },
      {
        action: "Produce the review worksheet",
        control: "1099 review",
        route: "/reports/1099",
        note:
          "This is a review worksheet on a cash basis, not a filing. It must be " +
          "checked by someone qualified before anything is submitted.",
      },
    ],
  },
  {
    id: "governance",
    title: "Control who can do what",
    purpose: "Give people the access their job needs, and no more.",
    route: "/settings/users",
    steps: [
      { action: "Add or suspend a person", control: "New user", route: "/settings/users" },
      {
        action: "Set what each role may do",
        control: "Permissions",
        route: "/settings/permissions",
      },
      {
        action: "Require a second pair of eyes",
        control: "Approvals",
        route: "/settings/approvals",
        note:
          "Configure which actions need approval and above what amount. A person " +
          "cannot approve their own request.",
      },
      {
        action: "See who changed what",
        control: "Audit history",
        route: "/settings/audit",
        note: "Every protected write records the actor, the action and the before and after values.",
      },
    ],
  },
  {
    id: "feedback",
    title: "Tell us what is wrong or missing",
    purpose:
      "During this test round, this is the channel that turns what you notice into a " +
      "tracked item.",
    route: "/settings/feedback",
    steps: [
      {
        action: "Report a problem or suggest an improvement",
        control: "Report",
        note:
          "The floating Report button works on every page. It captures a screenshot " +
          "of what you are looking at — you can send the report without it.",
      },
      {
        action: "Ask how something is meant to work",
        control: "Ask AI",
        note:
          "Answers come from this system's own guides. The assistant cannot see your " +
          "data, so it will not quote balances.",
      },
      {
        action: "Follow what happens to a report",
        control: "Feedback triage",
        route: "/settings/feedback",
        note: "Reports move through New, Reviewing, Resolved and Declined.",
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
