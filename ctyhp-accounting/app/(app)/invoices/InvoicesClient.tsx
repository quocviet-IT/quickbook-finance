"use client";
import { useMemo, useState } from "react";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  type DescriptionsProps,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import {
  PaperClipOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { PAID_LABELS } from "@/lib/domain/status-label";
import FilterBar from "@/components/ui/FilterBar";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { isOverdueDocument, matchesDocumentKeyword } from "@/lib/domain/document-filter";
import IconActionButton from "@/components/ui/IconActionButton";
import dynamic from "next/dynamic";
import type { AttachmentTarget } from "@/components/documents/AttachmentDrawer";
import type {
  AccountRow,
  ActorRow,
  AuditEntryRow,
  CurrencyRow,
  TaxCodeRow,
  CustomerRow,
  InvoiceStatus,
  InvoiceLineRow,
  ItemRow,
} from "@/lib/db/types";
import type { InvoiceEstimateLink, InvoiceWithCustomer } from "@/lib/services/invoicing";
import type { CustomerCreditRow } from "@/lib/services/credit";
import { formatDate, formatMoney, toMinorUnits } from "@/lib/format";
import { useCompanyClock } from "@/components/CompanyClock";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import SalesLineItems, { SALES_DOCUMENT_MODAL_WIDTH } from "@/components/SalesLineItems";
import { validateOrFocus } from "@/lib/client/validate-or-focus";
import { draftInvoiceCreatedMessage } from "@/lib/domain/sales-form";
import {
  estimateMessages,
  invoiceFormFromEstimate,
  type EstimateInvoicePrefill,
} from "@/lib/domain/estimates";
import {
  CREDIT_SALES_WINDOW_DAYS,
  checkInvoiceAgainstCredit,
  creditStateColor,
  describeDso,
  type InvoiceCreditCheck,
} from "@/lib/domain/credit";
import {
  defaultTaxCodeForState,
  groupTaxCodesByState,
  taxCodeLabel,
} from "@/lib/domain/tax-jurisdiction";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import SettlementHistory from "@/components/settlements/SettlementHistory";
import type { SettlementEvent } from "@/lib/domain/settlement";
import {
  createInvoiceAction,
  createCustomerAction,
  issueInvoiceAction,
  voidInvoiceAction,
  getInvoiceDetailAction,
  getInvoiceDocumentAction,
} from "./actions";
import { downloadInvoicePdf } from "@/lib/client/invoice-pdf";
import WriteOffModal from "../settlements/WriteOffModal";
import RowActionsMenu from "@/components/ui/RowActionsMenu";
import { MAKE_RECURRING, useMakeRecurring } from "@/components/recurring/useMakeRecurring";
import { closeOrConfirmDiscard, destructiveConfirmProps } from "@/lib/client/destructive-confirm";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { invoiceVoidConfirm, invoiceVoidOption } from "@/lib/domain/invoice-void";
import {
  invoiceAttention,
  invoiceAttentionLook,
  invoiceStatusCounts,
  sortInvoicesByAttention,
  type InvoiceStatusTab,
} from "@/lib/domain/invoice-attention";
import { tokenVar } from "@/lib/design/tokens";

interface LineForm {
  description?: string;
  quantity?: number;
  unit_price?: number; // major units
  income_account_id?: string;
  tax_code_id?: string | null;
  item_id?: string | null;
}


/** Loaded on demand — see tests/unit/attachment-drawer-lazy.test.ts. */
const AttachmentDrawer = dynamic(() => import("@/components/documents/AttachmentDrawer"), {
  ssr: false,
});

/** The dialog an invoice's lines open in, whose body is the lines table's box. */
export const VIEW_INVOICE_MODAL_WIDTH = 820;

/**
 * Quantity, Unit price, Subtotal, Tax. Description takes what is left. They
 * were 90, 110, 110 and 100, this dialog's own numbers; the amounts now take
 * the width every other money column has.
 */
export const INVOICE_LINES_FIXED_WIDTHS = [COLUMN.QTY, COLUMN.MONEY, COLUMN.MONEY, COLUMN.MONEY] as const;

/**
 * The list's measured columns: Number, Issued, Due, Total, Balance due,
 * Status, Actions. Customer takes what is left, at least COLUMN.TEXT_MIN at
 * 1280px (tests/unit/invoice-list-layout.test.ts). Adding Due in 3.0.11 cost
 * 88px, paid for by Number (110 → 100: "INV-000004" is 80px of text) and
 * Actions (140 → 124: paperclip, Issue and ⋮ need 122).
 */
/** The status tabs above the list, in the order an accountant works them. */
const INVOICE_STATUS_TABS: readonly { key: InvoiceStatusTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Draft" },
  { key: "issued", label: "Issued" },
  { key: "partial", label: "Partially paid" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

export const INVOICE_LIST_FIXED_WIDTHS = [
  100,
  COLUMN.DATE,
  COLUMN.DATE,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.STATUS,
  124,
] as const;

export default function InvoicesClient({
  initialCreateOpen,
  estimatePrefill,
  estimateNotice,
  initialQueue,
  invoices,
  customers,
  incomeAccounts,
  defaultIncomeAccountId = null,
  expenseAccounts,
  taxCodes,
  currencies,
  items,
  canManageItems,
  canWrite,
  canCreate,
  canIssue,
  canVoid,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  canReadAudit,
  actors,
  usStates,
  credit,
  canOverrideCredit,
  defaultTermsDays,
  sequenceWarning,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  /** From "Turn into an invoice" (`?estimate=`): the customer and lines the form opens with. */
  estimatePrefill: EstimateInvoicePrefill | null;
  /** Shown instead of opening the form when that estimate cannot be turned into an invoice now. */
  estimateNotice: string | null;
  initialQueue: { asOf: string; focusId: string | null } | null;
  invoices: InvoiceWithCustomer[];
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  /** The company's default income account (3.01), for a line with no item. */
  defaultIncomeAccountId?: string | null;
  expenseAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
  canWrite: boolean;
  /**
   * Holds `invoice.create`, which sales holds too: a sales user prepares the
   * draft and an admin or accountant issues it. The RPC checks it again.
   */
  canCreate: boolean;
  /** Holds `invoice.issue`; the RPC checks it again. */
  canIssue: boolean;
  /** Holds `invoice.void`; the RPC checks it again. */
  canVoid: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  /** Gates the change history block; the RPC behind it refuses the call anyway. */
  canReadAudit: boolean;
  actors: ActorRow[];
  usStates: { code: string; name: string }[];
  /** Credit exposure per customer, read from the open invoices. */
  credit: CustomerCreditRow[];
  /** Whether this user may issue past a limit; the RPC checks it again. */
  canOverrideCredit: boolean;
  /** Company default payment terms, used when a customer sets none of their own. */
  defaultTermsDays: number;
  /** Set when the invoice sequence has a break nobody has accounted for. */
  sequenceWarning: string | null;
}) {
  const { message, modal } = App.useApp();
  const { makeRecurring, pendingId: recurringId } = useMakeRecurring();
  const router = useRouter();
  const [form] = Form.useForm();
  /** A new invoice's first line: on the company's default income account until an item says otherwise (3.01). */
  const newInvoiceLine = { quantity: 1, income_account_id: defaultIncomeAccountId ?? undefined };
  const [open, setOpen] = useInitiallyOpen(initialCreateOpen);
  // Set by the reader's own typing or picking, not by the defaults the form
  // opens with: closing a form nobody touched needs no question.
  const [createDirty, setCreateDirty] = useState(false);
  useUnsavedGuard(open && createDirty, modal, "this invoice");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<InvoiceWithCustomer | null>(null);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);
  const [overrideFor, setOverrideFor] = useState<{
    invoice: InvoiceWithCustomer;
    check: InvoiceCreditCheck;
  } | null>(null);
  const [overrideForm] = Form.useForm();

  // Turning an estimate into an invoice. Both are read once: after the draft
  // is made, the refreshed page finds the estimate converted, which is not
  // news to the person who just converted it.
  const [fromEstimate, setFromEstimate] = useState(estimatePrefill);
  const [estimateNoticeShown, setEstimateNoticeShown] = useState(estimateNotice);
  const [createError, setCreateError] = useState<string | null>(null);

  // Inline customer creation
  const [custOpen, setCustOpen] = useState(false);
  const [custForm] = Form.useForm();
  const [localCustomers, setLocalCustomers] = useState<CustomerRow[]>(customers);

  // View lines
  const [linesOpen, setLinesOpen] = useState(false);
  const [viewLines, setViewLines] = useState<InvoiceLineRow[]>([]);
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [viewAudit, setViewAudit] = useState<AuditEntryRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [viewSettlements, setViewSettlements] = useState<SettlementEvent[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [viewEstimate, setViewEstimate] = useState<InvoiceEstimateLink | null>(null);

  const directory = useMemo(
    () => new Map(actors.map((a) => [a.id, a.email || a.full_name])),
    [actors],
  );

  // Rates differ by state, so the picker is grouped by state rather than being
  // a flat list of codes nobody can tell apart.
  const taxOptions = useMemo(
    () =>
      groupTaxCodesByState(taxCodes, usStates).map((group) => ({
        label: group.stateName,
        title: group.stateName,
        options: group.codes.map((code) => ({ value: code.id, label: taxCodeLabel(code) })),
      })),
    [taxCodes, usStates],
  );

  // One "today" for every row, so a list cannot show two different ages.
  const { today } = useCompanyClock();

  const creditByCustomer = useMemo(
    () => new Map(credit.map((row) => [row.customerId, row])),
    [credit],
  );

  const baseCurrency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const taxRateOf = (id?: string | null) =>
    id ? Number(taxCodes.find((t) => t.id === id)?.rate_percent ?? 0) : 0;

  const currency: string = Form.useWatch("currency_code", form) ?? baseCurrency;
  const watchedLines: LineForm[] = Form.useWatch("lines", form) ?? [];
  const watchedCustomerId: string | undefined = Form.useWatch("customer_id", form);

  const previewTotals = useMemo(() => {
    const dec = decimalsOf(currency);
    const computed = (watchedLines ?? [])
      .filter((l) => l && (l.quantity ?? 0) > 0 && (l.unit_price ?? 0) >= 0)
      .map((l) =>
        computeInvoiceLine({
          quantity: Number(l.quantity ?? 0),
          unitPriceMinor: toMinorUnits(Number(l.unit_price ?? 0), dec),
          taxRatePercent: taxRateOf(l.tax_code_id),
        }),
      );
    return sumInvoiceTotals(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedLines, currency]);

  const draftCredit = useMemo(() => {
    const row = watchedCustomerId ? creditByCustomer.get(watchedCustomerId) : undefined;
    if (!row) return null;
    return {
      row,
      check: checkInvoiceAgainstCredit({
        status: row.status,
        creditLimitMinor: row.creditLimitMinor,
        creditHold: row.creditHold,
        openBalanceMinor: row.openBalanceMinor,
        invoiceTotalMinor: previewTotals.totalMinor,
        hasBillingAddress: row.hasBillingAddress,
      }),
    };
  }, [watchedCustomerId, creditByCustomer, previewTotals.totalMinor]);

  // What the reader types and picks. "Overdue" is the option this register
  // exists to answer — QuickBooks and Xero both lead their invoice queues
  // with it — and it reuses the exact rule the dashboard's work queue already
  // applies, via the shared helper, so the two can never disagree.
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusTab>("all");
  // `today` above is the one the Status column's "N days late" uses; the
  // Overdue tab reads the same clock, so a row tagged overdue is always in it.

  /** The reader's own search or status choice, as opposed to the work queue's. */
  const narrowed = Boolean(keyword) || statusFilter !== "all";
  function clearFilters() {
    setKeyword("");
    setStatusFilter("all");
  }

  const visibleInvoices = useMemo(() => {
    // Overdue first, then due within a week, then drafts, then the rest (3.0.11).
    if (!initialQueue) return sortInvoicesByAttention(invoices, today);
    const filtered = invoices.filter(
      (invoice) =>
        (invoice.status === "issued" || invoice.status === "partial") &&
        invoice.balance_due_minor > 0 &&
        Boolean(invoice.due_date) &&
        invoice.due_date! < initialQueue.asOf,
    );
    return [...filtered].sort((left, right) => {
      if (left.id === initialQueue.focusId) return -1;
      if (right.id === initialQueue.focusId) return 1;
      return (left.due_date ?? "").localeCompare(right.due_date ?? "");
    });
  }, [initialQueue, invoices, today]);

  /** What each status tab holds, counted by the rule its filter applies. */
  const statusCounts = useMemo(() => invoiceStatusCounts(visibleInvoices, today), [visibleInvoices, today]);

  const filteredInvoices = visibleInvoices.filter((invoice) => {
    if (!matchesDocumentKeyword([invoice.invoice_number, invoice.customer_name], keyword)) {
      return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "overdue") {
      return isOverdueDocument(
        { status: invoice.status, dueDate: invoice.due_date, balanceDueMinor: invoice.balance_due_minor },
        today,
      );
    }
    return invoice.status === statusFilter;
  });

  function openCreate() {
    setFromEstimate(null);
    setCreateError(null);
    form.resetFields();
    // The modal destroys its fields on close but this form instance keeps its
    // store, so a reset while closed does not reach them. Clear what an estimate,
    // or a cancelled draft, may have left, so New invoice always starts empty.
    form.setFieldsValue({
      customer_id: undefined,
      issue_date: undefined,
      due_date: undefined,
      memo: undefined,
      currency_code: baseCurrency,
      lines: [newInvoiceLine],
    });
    setCreateDirty(false);
    setOpen(true);
  }

  function finishCreate() {
    setCreateDirty(false);
    setOpen(false);
  }

  /** Escape, the close button and Cancel: asks first once something has been typed. */
  function closeCreate() {
    closeOrConfirmDiscard({
      dirty: createDirty,
      what: "this invoice",
      confirm: modal.confirm,
      close: finishCreate,
    });
  }

  /**
   * Opened from an estimate: its customer and lines, and the due date set from
   * the customer's terms as picking the customer would set it. Not the rest of
   * what picking a customer does: the estimate's lines keep their own tax
   * codes, so an untaxed line is not taxed on the way (invoiceFormFromEstimate).
   */
  const estimateFormValues = useMemo(() => {
    if (!fromEstimate) return null;
    const customer = localCustomers.find((c) => c.id === fromEstimate.values.customer_id);
    const { dueInDays, ...values } = invoiceFormFromEstimate(fromEstimate, {
      currencyCode: baseCurrency,
      customerTermsDays: customer?.credit_terms_days,
      defaultTermsDays,
    });
    return { ...values, due_date: dayjs(today).add(dueInDays, "day") };
  }, [fromEstimate, localCustomers, baseCurrency, defaultTermsDays, today]);

  /**
   * Most states tax a sale where it is delivered, so picking a customer fills
   * the rate registered in that customer's state — on lines that have none yet,
   * never over a rate somebody chose. Nothing is filled where the company has
   * no rate there, or where its state has more than one: neither is a default.
   */
  function applyCustomerDefaults(customerId: string) {
    const customer = localCustomers.find((c) => c.id === customerId);

    // Terms are a promise about when the money arrives, so they belong on the
    // invoice the moment the customer is known — net 15 for a retail buyer and
    // net 30 for a trade account are different due dates, not a preference.
    const terms = customer?.credit_terms_days ?? defaultTermsDays;
    const issue = form.getFieldValue("issue_date") ?? dayjs(today);
    form.setFieldValue("due_date", issue.add(terms, "day"));

    const rate = defaultTaxCodeForState(customer?.region, taxCodes);
    if (!rate) return;
    const lines: LineForm[] = form.getFieldValue("lines") ?? [];
    let filled = 0;
    lines.forEach((line, index) => {
      if (line?.tax_code_id) return;
      form.setFields([{ name: ["lines", index, "tax_code_id"], value: rate.id }]);
      filled += 1;
    });
    if (filled > 0) {
      message.info(`Applied ${taxCodeLabel(rate)} for ${customer?.region}`);
    }
  }

  async function submitCustomer() {
    const v = await custForm.validateFields();
    const res = await createCustomerAction(v);
    if (res.ok && res.data) {
      const c: CustomerRow = {
        id: res.data.id, name: res.data.name, email: null, currency_code: null,
        is_active: true, contact_name: null, phone: null, address_line1: null,
        address_line2: null, city: null, region: null, postal_code: null,
        country: null, credit_limit_minor: null, credit_terms_days: null,
        credit_hold: false, credit_reviewed_at: null, credit_review_note: null,
        created_at: "", updated_at: "",
      };
      setLocalCustomers((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
      form.setFieldValue("customer_id", c.id);
      message.success("Customer added");
      setCustOpen(false);
      custForm.resetFields();
    } else {
      message.error(res.error ?? "Failed to add customer");
    }
  }

  async function submitInvoice() {
    // On a wrong or missing field: focus goes to the first one, nothing is sent.
    const v = await validateOrFocus(form);
    if (!v) return;
    const dec = decimalsOf(v.currency_code);
    const lines = (v.lines as LineForm[]).map((l) => ({
      description: l.description ?? "",
      quantity: Number(l.quantity),
      unit_price_minor: toMinorUnits(Number(l.unit_price ?? 0), dec),
      income_account_id: l.income_account_id!,
      tax_code_id: l.tax_code_id || null,
      item_id: l.item_id || null,
    }));
    setSaving(true);
    setCreateError(null);
    const res = await createInvoiceAction({
      customer_id: v.customer_id,
      currency_code: v.currency_code,
      issue_date: v.issue_date ? v.issue_date.format("YYYY-MM-DD") : undefined,
      due_date: v.due_date ? v.due_date.format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
      lines,
      // Makes the draft and links it to the estimate in one transaction.
      ...(fromEstimate ? { estimateId: fromEstimate.estimateId } : {}),
    });
    setSaving(false);
    if (fromEstimate) {
      if (!res.ok) {
        // The database's words, in the form: the estimate was converted or
        // declined meanwhile, or the customer no longer matches.
        setCreateError(res.error ?? "Failed to create invoice");
        return;
      }
      message.success(estimateMessages.invoiceCreated(fromEstimate.estimateNumber));
      setFromEstimate(null);
      finishCreate();
      // Off the estimate's link, so a reload does not try to convert it again.
      router.replace("/invoices");
      return;
    }
    if (res.ok) {
      const customerName = localCustomers.find((c) => c.id === v.customer_id)?.name ?? "the customer";
      message.success(draftInvoiceCreatedMessage(customerName));
      finishCreate();
    } else {
      // In the form, where it stays until the next save, as on the estimate
      // path above: a toast disappeared before it could be read (3.0.10).
      setCreateError(res.error ?? "Failed to create invoice");
    }
  }

  async function issue(id: string, overrideReason?: string) {
    setBusyId(id);
    const res = await issueInvoiceAction(id, overrideReason);
    setBusyId(null);
    if (res.ok) {
      message.success("Invoice issued and posted to the ledger");
      // Issued from its dialog: the dialog showed the draft, which no longer exists.
      setLinesOpen(false);
    } else message.error(res.error ?? "Failed to issue invoice");
  }

  /**
   * Issuing over a limit is refused by the database. Someone who may override
   * is asked for the reason here; it is stored with the invoice as its own
   * audit action. Anyone else is told what stands in the way.
   */
  function startIssue(invoice: InvoiceWithCustomer) {
    const row = creditByCustomer.get(invoice.customer_id);
    const check = row
      ? checkInvoiceAgainstCredit({
          status: row.status,
          creditLimitMinor: row.creditLimitMinor,
          creditHold: row.creditHold,
          openBalanceMinor: row.openBalanceMinor,
          invoiceTotalMinor: invoice.total_minor,
          hasBillingAddress: row.hasBillingAddress,
        })
      : null;

    if (!check?.blocked) {
      void issue(invoice.id);
      return;
    }
    setOverrideFor({ invoice, check });
    overrideForm.resetFields();
  }

  async function submitOverride() {
    if (!overrideFor) return;
    const values = await overrideForm.validateFields();
    const target = overrideFor;
    setOverrideFor(null);
    await issue(target.invoice.id, values.reason);
  }

  async function voidInv(id: string) {
    setBusyId(id);
    const res = await voidInvoiceAction(id);
    setBusyId(null);
    if (res.ok) {
      message.success("Invoice voided");
      setLinesOpen(false);
    } else message.error(res.error ?? "Failed to void invoice");
  }

  /**
   * Void asks in a dialog rather than a popover, now that it lives in a menu.
   *
   * A Popconfirm anchored to a menu item lands over the menu it came from, and
   * says the least at the moment the reader most needs telling — that this
   * reverses a posted journal entry and cannot be undone by re-issuing. A
   * draft's question says the ledger does not change, since it posted nothing,
   * and the dialog opens with focus on Cancel, not on Void.
   */
  function confirmVoid(invoice: InvoiceWithCustomer) {
    modal.confirm(
      destructiveConfirmProps({
        ...invoiceVoidConfirm(invoice),
        okText: "Void",
        onOk: () => voidInv(invoice.id),
      }),
    );
  }

  async function viewInvoiceLines(inv: InvoiceWithCustomer) {
    setViewInvoice(inv);
    setViewLines([]);
    setViewAudit([]);
    setViewSettlements([]);
    setViewEstimate(null);
    setLinesOpen(true);
    setSettlementsLoading(true);
    if (canReadAudit) setAuditLoading(true);
    // One request: Next runs Server Actions one at a time, so these three
    // reads sent as separate actions were three trips in a row.
    const { lines: res, settlements: settled, audit: trail, estimate: madeFrom } = await getInvoiceDetailAction(inv.id, canReadAudit);
    setSettlementsLoading(false);
    setAuditLoading(false);
    if (res.ok && res.data) setViewLines(res.data);
    else message.error(res.error ?? "Failed to load lines");
    if (settled.ok && settled.data) setViewSettlements(settled.data);
    else message.error(settled.error ?? "Failed to load the payment history");
    if (madeFrom.ok) setViewEstimate(madeFrom.data ?? null);
    else message.error(madeFrom.error ?? "Failed to load the estimate it was made from");
    if (!trail) return;
    if (trail.ok && trail.data) setViewAudit(trail.data);
    else message.error(trail.error ?? "Failed to load the change history");
  }

  async function downloadPdf(inv: InvoiceWithCustomer) {
    setPdfId(inv.id);
    try {
      const res = await getInvoiceDocumentAction(inv.id);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to build the invoice PDF");
        return;
      }
      await downloadInvoicePdf(res.data, inv.invoice_number, inv.issue_date);
    } finally {
      setPdfId(null);
    }
  }

  const money = (minor: number, code: string) => formatMoney(minor, code, decimalsOf(code));

  /** Void as the open invoice's dialog offers it: the menu's rule (invoiceVoidOption). */
  const viewVoid = viewInvoice ? invoiceVoidOption(viewInvoice) : null;

  /**
   * The head of an invoice's dialog: who, what state, which dates, which entry
   * and what is still owed (3.0.11). The status reads as in the list, plus how
   * late or how soon when that is the point.
   */
  function invoiceHeaderItems(inv: InvoiceWithCustomer): DescriptionsProps["items"] {
    const look = invoiceAttentionLook(invoiceAttention(inv, today));
    const code = look?.tone === "danger" ? "overdue" : "due_soon";
    return [
      { key: "customer", label: "Customer", children: inv.customer_name },
      {
        key: "status",
        label: "Status",
        children: (
          <Space size={4} wrap>
            <StatusTag status={inv.status} labels={PAID_LABELS} />
            {look ? <StatusTag status={code} looks={{ [code]: look }} /> : null}
          </Space>
        ),
      },
      { key: "issued", label: "Issued", children: formatDate(inv.issue_date) },
      { key: "due", label: "Due", children: inv.due_date ? formatDate(inv.due_date) : "—" },
      {
        key: "entry",
        label: "Journal entry",
        children:
          inv.entry_number && inv.journal_entry_id ? (
            <Link href={`/journal?entry=${inv.journal_entry_id}`}>{inv.entry_number}</Link>
          ) : (
            "Not posted yet"
          ),
      },
      { key: "balance", label: "Balance due", children: money(inv.balance_due_minor, inv.currency_code) },
    ];
  }

  // One line per row since 3.0.11. The journal entry, who raised the invoice and
  // what has been paid moved to the invoice's dialog; how late it is moved to
  // the status. Rows had been 58–59px, three cells stacking a second line.
  const columns: TableColumnsType<InvoiceWithCustomer> = [
    {
      title: "Number",
      dataIndex: "invoice_number",
      width: INVOICE_LIST_FIXED_WIDTHS[0],
      // No default sort: the list opens in attention order (sortInvoicesByAttention).
      // Sorted by number, drafts (no number yet) come first.
      sorter: (a, b) => (a.invoice_number ?? "￿").localeCompare(b.invoice_number ?? "￿"),
      render: (n) => n ?? <StatusTag status="draft" />,
    },
    {
      // The elastic column: no width, so it takes whatever the measured ones leave.
      ...flexColumn<InvoiceWithCustomer>({
        title: "Customer",
        key: "customer_name",
        render: (_: unknown, r: InvoiceWithCustomer) => <span title={r.customer_name}>{r.customer_name}</span>,
      }),
      sorter: (a: InvoiceWithCustomer, b: InvoiceWithCustomer) =>
        a.customer_name.localeCompare(b.customer_name),
    },
    {
      // "Issue date" wrapped onto two lines inside the date token and made
      // every heading row taller; the one-word form says the same thing.
      title: "Issued",
      dataIndex: "issue_date",
      width: INVOICE_LIST_FIXED_WIDTHS[1],
      render: (v: string) => formatDate(v),
      sorter: (a, b) => a.issue_date.localeCompare(b.issue_date),
    },
    {
      title: "Due",
      dataIndex: "due_date",
      width: INVOICE_LIST_FIXED_WIDTHS[2],
      render: (v: string | null) => (v ? formatDate(v) : "—"),
      sorter: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
    },
    {
      title: "Total",
      dataIndex: "total_minor",
      width: INVOICE_LIST_FIXED_WIDTHS[3],
      align: "right",
      sorter: (a, b) => a.total_minor - b.total_minor,
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Balance due",
      dataIndex: "balance_due_minor",
      width: INVOICE_LIST_FIXED_WIDTHS[4],
      align: "right",
      sorter: (a, b) => a.balance_due_minor - b.balance_due_minor,
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      // A row that needs attention says so in its status, "200 days late"
      // or "Due in 5 days"; the rest show the invoice's own status.
      title: "Status",
      dataIndex: "status",
      width: INVOICE_LIST_FIXED_WIDTHS[5],
      render: (s: InvoiceStatus, r: InvoiceWithCustomer) => {
        const look = invoiceAttentionLook(invoiceAttention(r, today));
        if (!look) return <StatusTag status={s} labels={PAID_LABELS} />;
        const code = look.tone === "danger" ? "overdue" : "due_soon";
        return <StatusTag status={code} looks={{ [code]: look }} />;
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: INVOICE_LIST_FIXED_WIDTHS[6],
      align: "right",
      // The shape Payments settled on and Bills followed: the paperclip, the one
      // state-advancing action a draft has, and everything else behind one ⋯.
      //
      // This column used to put three icon buttons and up to three text buttons
      // in a row, a different set per status — so a paid invoice showed three
      // controls, a draft showed five, and nothing lined up down the column. The
      // eye and the PDF are still one click away; they are simply no longer
      // competing with Void for the reader's attention.
      render: (_: unknown, r) => {
        const menu: MenuProps["items"] = [
          { key: "lines", label: "View lines", onClick: () => viewInvoiceLines(r) },
          {
            key: "pdf",
            label: pdfId === r.id ? "Preparing PDF…" : "Download PDF",
            disabled: pdfId === r.id,
            onClick: () => downloadPdf(r),
          },
        ];
        if (canWrite && (r.status === "issued" || r.status === "partial")) {
          menu.push({ key: "writeoff", label: "Write off", onClick: () => setWriteOffFor(r) });
        }
        if (canWrite && r.status !== "draft" && r.status !== "void") {
          menu.push({
            key: "recurring",
            label: MAKE_RECURRING,
            disabled: recurringId === r.id,
            onClick: () => void makeRecurring("invoice", r.id),
          });
        }
        // Last, and separated. The divider is conditional because a menu whose
        // only item is Void would otherwise open with an orphaned line above it.
        // Once money is applied the database refuses a void, so the item stays
        // in its place, disabled, and says why — rather than refusing only
        // after the reader has confirmed.
        const voidOption = invoiceVoidOption(r);
        if (canVoid && voidOption.offered) {
          if (menu.length) menu.push({ type: "divider" as const, key: "before-void" });
          menu.push({
            key: "void",
            label: voidOption.blockedReason ? (
              <>
                Void invoice
                {secondaryLine(voidOption.blockedReason)}
              </>
            ) : (
              "Void invoice"
            ),
            danger: true,
            disabled: voidOption.blockedReason !== null,
            onClick: () => confirmVoid(r),
          });
        }
        return (
          <Space size={4}>
            {canReadDocuments ? (
              <IconActionButton
                label="Manage invoice attachments"
                icon={<PaperClipOutlined />}
                onClick={() =>
                  setAttachmentTarget({
                    entityType: "invoice",
                    entityId: r.id,
                    label: `${r.invoice_number ?? "Draft invoice"} · ${r.customer_name}`,
                  })
                }
              />
            ) : null}
            {canIssue && r.status === "draft" && (
              <Button size="small" loading={busyId === r.id} onClick={() => startIssue(r)}>
                Issue
              </Button>
            )}
            <RowActionsMenu items={menu} label={`Actions for ${r.invoice_number ?? "draft invoice"}`} />
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      {estimateNoticeShown ? (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          title={estimateNoticeShown}
          onClose={() => setEstimateNoticeShown(null)}
          action={
            <Button size="small" onClick={() => router.push("/estimates")}>
              Open estimates
            </Button>
          }
        />
      ) : null}

      {sequenceWarning ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Break in the invoice number sequence"
          description={sequenceWarning}
          action={
            <Button size="small" onClick={() => router.push("/reports/number-sequence")}>
              Open the sequence report
            </Button>
          }
        />
      ) : null}

      {/* Status tabs with their counts, in place of a status select (3.0.11):
          how many are overdue is the first thing this list is opened to learn. */}
      <Tabs
        className="accounting-status-tabs"
        activeKey={statusFilter}
        onChange={(key) => setStatusFilter(key as InvoiceStatusTab)}
        items={INVOICE_STATUS_TABS.map(({ key, label }) => ({
          key,
          label: (
            <span>
              {label}{" "}
              <span style={{ color: tokenVar("text.secondary"), fontVariantNumeric: "tabular-nums" }}>
                {statusCounts[key]}
              </span>
            </span>
          ),
        }))}
      />

      <FilterBar
        resultCount={filteredInvoices.length}
        actions={
          canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New invoice
            </Button>
          ) : null
        }
      >
        {initialQueue ? (
          <div className="accounting-queue-filter">
            <Tag color="red">Work queue · overdue invoices</Tag>
            <Typography.Text type="secondary">As of {formatDate(initialQueue.asOf)}</Typography.Text>
            <Button onClick={() => router.push("/invoices")}>Show all</Button>
          </div>
        ) : null}
        <Input.Search
          allowClear
          aria-label="Search invoices by number or customer"
          placeholder="Search number or customer"
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </FilterBar>

      <DataTable<InvoiceWithCustomer>
        rowKey="id"
        columns={columns}
        dataSource={filteredInvoices}
        rowClassName={(invoice) =>
          invoice.id === initialQueue?.focusId ? "accounting-data-row--focused" : ""
        }
        sticky
        emptyTitle={
          narrowed
            ? "No invoices match these filters"
            : initialQueue
              ? "No overdue invoices"
              : "No invoices yet"
        }
        emptyDescription={
          narrowed
            ? "Clear the filters, or search for another number or customer."
            : initialQueue
              ? "Customer balances are current as of the selected work queue date."
              : "Create a draft invoice, review it, then issue it to the ledger."
        }
        // The next step, in the empty table itself (3.0.10). The work queue
        // already offers Show all beside its tag.
        emptyAction={
          narrowed ? (
            <Button onClick={clearFilters}>Clear filters</Button>
          ) : !initialQueue && canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New invoice
            </Button>
          ) : undefined
        }
      />

      {/* Fetched when a paperclip is clicked. The drawer already did nothing
          until it had a target — every effect inside returns early on a null
          one — so this changes when it downloads, not what it does. */}
      {attachmentTarget ? (
        <AttachmentDrawer
          target={attachmentTarget}
          canManage={canManageDocuments}
          canGovern={canGovernDocuments}
          onClose={() => setAttachmentTarget(null)}
        />
      ) : null}

      {/* Create invoice */}
      <Modal
        title="New invoice"
        open={open}
        onOk={submitInvoice}
        onCancel={closeCreate}
        // A click beside the form is too easy to make to cost a half-written invoice.
        maskClosable={false}
        confirmLoading={saving}
        okText="Save draft"
        cancelText="Cancel"
        width={SALES_DOCUMENT_MODAL_WIDTH}
        destroyOnHidden
      >
        {fromEstimate ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title={estimateMessages.fromEstimate(fromEstimate.estimateNumber)}
          />
        ) : null}
        {/* Defaults live here too, so opening straight from the New menu matches
            what the New invoice button sets up. */}
        <Form
          form={form}
          layout="vertical"
          initialValues={estimateFormValues ?? { currency_code: baseCurrency, lines: [newInvoiceLine] }}
          // Fires on the reader's edits only; the defaults set above do not count.
          onValuesChange={() => setCreateDirty(true)}
        >
          <Space align="end" wrap>
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]} style={{ minWidth: 280 }}>
              <Select
                showSearch
                filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                placeholder="Select a customer"
                options={localCustomers.map((c) => ({ value: c.id, label: c.name }))}
                onChange={applyCustomerDefaults}
                // The database takes only the estimate's own customer.
                disabled={Boolean(fromEstimate)}
              />
            </Form.Item>
            {/* Customers stay with admins and accountants; sales picks one that exists. */}
            {canWrite ? (
              <Form.Item label=" ">
                <Button onClick={() => setCustOpen(true)} disabled={Boolean(fromEstimate)}>
                  + New customer
                </Button>
              </Form.Item>
            ) : null}
            <Form.Item name="currency_code" label="Currency" rules={[{ required: true }]} style={{ width: 150 }}>
              <Select disabled options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
            </Form.Item>
            <Form.Item name="issue_date" label="Issue date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="due_date" label="Due date">
              <DatePicker />
            </Form.Item>
          </Space>

          {draftCredit ? (
            <Alert
              style={{ marginBottom: 12 }}
              type={
                draftCredit.check.blocked
                  ? "error"
                  : draftCredit.check.warning
                    ? "warning"
                    : "success"
              }
              showIcon
              message={
                <Space wrap size="middle">
                  <Tag color={creditStateColor(draftCredit.row.status.state)}>
                    {draftCredit.row.status.label}
                  </Tag>
                  <span>
                    Owed now{" "}
                    <b>{formatMoney(draftCredit.row.openBalanceMinor, baseCurrency, 2)}</b>
                  </span>
                  <span>
                    Limit{" "}
                    <b>
                      {draftCredit.row.creditLimitMinor === null
                        ? "not set"
                        : formatMoney(draftCredit.row.creditLimitMinor, baseCurrency, 2)}
                    </b>
                  </span>
                  <span>
                    After this invoice{" "}
                    <b>
                      {formatMoney(draftCredit.check.projectedBalanceMinor, baseCurrency, 2)}
                    </b>
                  </span>
                  {draftCredit.check.projectedAvailableMinor !== null ? (
                    <span>
                      Available{" "}
                      <b>
                        {formatMoney(draftCredit.check.projectedAvailableMinor, baseCurrency, 2)}
                      </b>
                    </span>
                  ) : null}
                  {draftCredit.row.status.daysSalesOutstanding !== null ? (
                    <span>
                      DSO <b>{describeDso(draftCredit.row.status.daysSalesOutstanding, CREDIT_SALES_WINDOW_DAYS)}</b>
                    </span>
                  ) : null}
                </Space>
              }
              description={
                draftCredit.check.message ??
                "This customer is inside their credit limit with nothing past due."
              }
            />
          ) : null}

          {/* Shared with the estimate form, so an estimate's lines and an invoice's are the same editor. */}
          <SalesLineItems
            items={items}
            incomeAccounts={incomeAccounts}
            taxOptions={taxOptions}
            decimals={decimalsOf(currency)}
            currencyCode={currency}
            canManageItems={canManageItems}
            removeLabel="Remove invoice line"
            defaultIncomeAccountId={defaultIncomeAccountId}
          />

          <Form.Item name="memo" label="Memo" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>

          <div style={{ textAlign: "right" }}>
            <div>Subtotal: {formatMoney(previewTotals.subtotalMinor, currency, decimalsOf(currency))}</div>
            <div>Tax: {formatMoney(previewTotals.taxTotalMinor, currency, decimalsOf(currency))}</div>
            <Typography.Text strong>
              Total: {formatMoney(previewTotals.totalMinor, currency, decimalsOf(currency))}
            </Typography.Text>
          </div>

          {createError ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={createError} /> : null}
        </Form>
      </Modal>

      {/* Inline new customer */}
      <Modal
        title="New customer"
        open={custOpen}
        onOk={submitCustomer}
        onCancel={() => setCustOpen(false)}
        okText="Add"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={custForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input type="email" autoComplete="email" />
          </Form.Item>
        </Form>
      </Modal>

      {/* View lines */}
      <Modal
        title={`Invoice ${viewInvoice?.invoice_number ?? "(draft)"}`}
        open={linesOpen}
        onCancel={() => setLinesOpen(false)}
        // The invoice's own actions, where the reader is looking at it (3.0.11).
        // Void follows the menu's rule: refused once money is applied, and then
        // the reason stands in its place.
        footer={
          viewInvoice ? (
            <Space wrap>
              {canVoid && viewVoid?.offered ? (
                viewVoid.blockedReason ? (
                  <Typography.Text type="secondary">{viewVoid.blockedReason}</Typography.Text>
                ) : (
                  <Button danger onClick={() => confirmVoid(viewInvoice)}>
                    Void invoice
                  </Button>
                )
              ) : null}
              <Button loading={pdfId === viewInvoice.id} onClick={() => downloadPdf(viewInvoice)}>
                Download PDF
              </Button>
              <Button onClick={() => setLinesOpen(false)}>Close</Button>
              {canIssue && viewInvoice.status === "draft" ? (
                <Button type="primary" loading={busyId === viewInvoice.id} onClick={() => startIssue(viewInvoice)}>
                  Issue
                </Button>
              ) : null}
            </Space>
          ) : null
        }
        width={VIEW_INVOICE_MODAL_WIDTH}
      >
        {/* Who, what state and which dates, before anything else. The journal
            entry and who raised it used to sit under the customer in the list. */}
        {viewInvoice ? (
          <Descriptions
            size="small"
            column={2}
            bordered
            style={{ marginBottom: 16 }}
            items={invoiceHeaderItems(viewInvoice)}
          />
        ) : null}

        {viewEstimate ? (
          <Typography.Paragraph>
            <Link href="/estimates">{estimateMessages.fromEstimate(viewEstimate.estimate_number)}</Link>
          </Typography.Paragraph>
        ) : null}

        <DataTable<InvoiceLineRow>
          rowKey="id"
          pagination={false}
          rows={viewLines}
          columns={[
            flexColumn<InvoiceLineRow>({ title: "Description", dataIndex: "description" }),
            { title: "Quantity", dataIndex: "quantity", width: INVOICE_LINES_FIXED_WIDTHS[0], align: "right" },
            {
              title: "Unit price",
              dataIndex: "unit_price_minor",
              width: INVOICE_LINES_FIXED_WIDTHS[1],
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
            {
              title: "Subtotal",
              dataIndex: "line_subtotal_minor",
              width: INVOICE_LINES_FIXED_WIDTHS[2],
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
            {
              title: "Tax",
              dataIndex: "line_tax_minor",
              width: INVOICE_LINES_FIXED_WIDTHS[3],
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
          ]}
        />

        {/* The invoice's own totals, under its lines, as the New invoice form shows them. */}
        {viewInvoice ? (
          <div style={{ textAlign: "right", marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
            <div>Subtotal: {money(viewInvoice.subtotal_minor, viewInvoice.currency_code)}</div>
            <div>Tax: {money(viewInvoice.tax_total_minor, viewInvoice.currency_code)}</div>
            <Typography.Text strong>Total: {money(viewInvoice.total_minor, viewInvoice.currency_code)}</Typography.Text>
          </div>
        ) : null}

        {viewInvoice ? (
          <div style={{ margin: "16px 0" }}>
            <SettlementHistory
              totalMinor={viewInvoice.total_minor}
              balanceDueMinor={viewInvoice.balance_due_minor}
              currencyCode={viewInvoice.currency_code}
              decimals={decimalsOf(viewInvoice.currency_code)}
              events={viewSettlements}
              loading={settlementsLoading}
              emptyText="No payment, credit or write-off has been applied to this invoice yet."
            />
          </div>
        ) : null}

        {/* Last: who changed what, for the reader checking the record. */}
        {viewInvoice ? (
          <DocumentAuditTrail
            record={viewInvoice}
            directory={directory}
            entries={viewAudit}
            loading={auditLoading}
            canReadAudit={canReadAudit}
          />
        ) : null}
      </Modal>

      <Modal
        title="Issue over the credit limit"
        open={overrideFor !== null}
        onOk={submitOverride}
        onCancel={() => setOverrideFor(null)}
        okText={canOverrideCredit ? "Override and issue" : "Close"}
        okButtonProps={{ danger: true, disabled: !canOverrideCredit }}
        cancelText="Cancel"
        destroyOnHidden
      >
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={overrideFor?.check.message ?? "This invoice breaks the customer credit limit."}
          description={
            canOverrideCredit
              ? "Issuing anyway is recorded against the invoice as a credit override, with your name and this reason."
              : "Your role cannot override a credit limit. Ask an administrator, or take a payment first."
          }
        />
        {canOverrideCredit ? (
          <Form form={overrideForm} layout="vertical">
            <Form.Item
              name="reason"
              label="Why is this invoice being issued anyway?"
              rules={[{ required: true, min: 10, message: "Give a reason of at least ten characters" }]}
            >
              <Input.TextArea rows={3} placeholder="e.g. Payment confirmed by wire, clearing tomorrow" />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>

      {writeOffFor && (
        <WriteOffModal
          open={!!writeOffFor}
          onClose={() => setWriteOffFor(null)}
          onDone={() => router.refresh()}
          side="ar"
          targetId={writeOffFor.id}
          currency={writeOffFor.currency_code}
          balanceMinor={writeOffFor.balance_due_minor}
          baseDecimals={decimalsOf(writeOffFor.currency_code)}
          offsetAccounts={expenseAccounts}
        />
      )}
    </div>
  );
}
