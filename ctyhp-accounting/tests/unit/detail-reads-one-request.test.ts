import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Next dispatches Server Actions one at a time per client ("Sequential
 * dispatch" in its Server Actions guide), so reads sent together with
 * Promise.all still ran one after another. Opening an invoice made three such
 * trips (lines, payments, change history), a payment two, and the feedback
 * queue three, again after every status change. Each now reads in one action
 * that does the work side by side on the server; every part keeps its own
 * error, as the separate actions did. Same fix as Bank Transactions (1.92).
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getInvoiceLines: vi.fn(),
  listInvoiceSettlements: vi.fn(),
  searchAudit: vi.fn(),
  listFeedbackReports: vi.fn(),
  listFeedbackAttachments: vi.fn(),
  listFeedbackImprovements: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ getUserRole: vi.fn(), canWrite: vi.fn() }));
vi.mock("@/lib/db/company", () => ({ activeSchema: vi.fn() }));
vi.mock("@/lib/db/automation", () => ({ createSupabaseAutomationClient: vi.fn() }));
vi.mock("@/lib/services/access", () => ({ searchAudit: mocks.searchAudit, hasPermission: vi.fn() }));
vi.mock("@/lib/services/settlements", () => ({ listInvoiceSettlements: mocks.listInvoiceSettlements }));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  getInvoiceLines: mocks.getInvoiceLines,
}));
vi.mock("@/lib/services/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/feedback")>()),
  listFeedbackReports: mocks.listFeedbackReports,
  listFeedbackAttachments: mocks.listFeedbackAttachments,
  listFeedbackImprovements: mocks.listFeedbackImprovements,
}));

import { getInvoiceDetailAction } from "@/app/(app)/invoices/actions";
import { getFeedbackTriageAction } from "@/app/(app)/settings/feedback/actions";

const sb = { marker: "company-bound" };
const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("getInvoiceDetailAction reads what the invoice drawer shows, in one request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(sb);
    mocks.getInvoiceLines.mockResolvedValue([{ id: "line-1" }]);
    mocks.listInvoiceSettlements.mockResolvedValue([{ kind: "payment" }]);
    mocks.searchAudit.mockResolvedValue([{ id: "audit-1" }]);
  });

  it("reads lines, settlements and the change history on one client", async () => {
    const detail = await getInvoiceDetailAction("inv-1", true);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.getInvoiceLines).toHaveBeenCalledWith(sb, "inv-1");
    expect(mocks.listInvoiceSettlements).toHaveBeenCalledWith(sb, "inv-1");
    expect(mocks.searchAudit).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({ table_name: "acc_invoice", record_id: "inv-1", limit: 200 }),
    );
    expect(detail).toEqual({
      lines: { ok: true, data: [{ id: "line-1" }] },
      settlements: { ok: true, data: [{ kind: "payment" }] },
      audit: { ok: true, data: [{ id: "audit-1" }] },
    });
  });

  it("does not ask for the change history when the viewer may not read it", async () => {
    const detail = await getInvoiceDetailAction("inv-1", false);
    expect(detail.audit).toBeNull();
    expect(mocks.searchAudit).not.toHaveBeenCalled();
  });

  it("keeps each read's failure to itself", async () => {
    mocks.listInvoiceSettlements.mockRejectedValue(new Error("settlements unavailable"));
    const detail = await getInvoiceDetailAction("inv-1", true);
    expect(detail.settlements).toEqual({ ok: false, error: "settlements unavailable" });
    expect(detail.lines).toEqual({ ok: true, data: [{ id: "line-1" }] });
  });

  it("reports every part failed, and reads nothing, when there are no books to read", async () => {
    mocks.createClient.mockRejectedValue(new Error("This account does not belong to any company."));
    const detail = await getInvoiceDetailAction("inv-1", true);
    const failed = { ok: false, error: "This account does not belong to any company." };
    expect(detail).toEqual({ lines: failed, settlements: failed, audit: failed });
    expect(mocks.getInvoiceLines).not.toHaveBeenCalled();
  });
});

describe("getFeedbackTriageAction reads the whole queue in one request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(sb);
    mocks.listFeedbackReports.mockResolvedValue([{ id: "r1" }]);
    mocks.listFeedbackAttachments.mockResolvedValue([{ id: "a1" }]);
    mocks.listFeedbackImprovements.mockResolvedValue([{ id: "i1" }]);
  });

  it("reads reports, attachments and improvements on one client", async () => {
    const queue = await getFeedbackTriageAction();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    for (const read of [mocks.listFeedbackReports, mocks.listFeedbackAttachments, mocks.listFeedbackImprovements]) {
      expect(read).toHaveBeenCalledWith(sb);
    }
    expect(queue).toEqual({
      reports: { ok: true, data: [{ id: "r1" }] },
      attachments: { ok: true, data: [{ id: "a1" }] },
      improvements: { ok: true, data: [{ id: "i1" }] },
    });
  });

  it("keeps each read's failure to itself", async () => {
    mocks.listFeedbackAttachments.mockRejectedValue(new Error("attachments unavailable"));
    const queue = await getFeedbackTriageAction();
    expect(queue.attachments).toEqual({ ok: false, error: "attachments unavailable" });
    expect(queue.reports).toEqual({ ok: true, data: [{ id: "r1" }] });
  });
});

describe("the screens send one read where they sent several", () => {
  it("the invoice drawer asks once", () => {
    const client = source("app/(app)/invoices/InvoicesClient.tsx");
    expect(client).toContain("getInvoiceDetailAction(inv.id, canReadAudit)");
    for (const old of ["getInvoiceLinesAction", "getInvoiceSettlementsAction", "getInvoiceAuditAction"]) {
      expect(client, old).not.toContain(old);
    }
  });

  it("the payment drawer asks once", () => {
    const drawer = source("app/(app)/payments/PaymentDetailDrawer.tsx");
    expect(drawer).toContain("getPaymentDrawerAction(");
    expect(drawer).not.toContain("getPaymentDetailAction");
    expect(drawer).not.toContain("getPaymentAuditAction");
  });

  it("the feedback queue asks once", () => {
    const client = source("app/(app)/settings/feedback/FeedbackTriageClient.tsx");
    expect(client).toContain("getFeedbackTriageAction()");
    for (const old of ["listFeedbackReportsAction", "listFeedbackAttachmentsAction", "listFeedbackImprovementsAction"]) {
      expect(client, old).not.toContain(old);
    }
  });
});
