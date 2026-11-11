"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Row,
  Segmented,
  Tabs,
  Tag,
  Tooltip,
  type DescriptionsProps,
  type TableColumnsType,
} from "antd";
import { EditOutlined, FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import RowActionsMenu from "@/components/ui/RowActionsMenu";
import FilterBar from "@/components/ui/FilterBar";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { ChangeHistoryTable, ChangeHistoryUnavailable } from "@/components/audit/DocumentAuditTrail";
import { useCompanyClock } from "@/components/CompanyClock";
import { COLUMN } from "@/lib/design/table-metrics";
import type { ActorRow, AuditEntryRow, CurrencyRow, CustomerRow, UsStateRow } from "@/lib/db/types";
import type { InvoiceWithCustomer } from "@/lib/services/invoicing";
import type { CustomerCreditRow } from "@/lib/services/credit";
import { CREDIT_SALES_WINDOW_DAYS, creditStateColor, describeDso } from "@/lib/domain/credit";
import {
  customerFacts,
  transactionTypeLabel,
  type CustomerTransaction,
  type CustomerTransactionType,
} from "@/lib/domain/customer-detail";
import { sortInvoicesByAttention } from "@/lib/domain/invoice-attention";
import { InvoiceStatusTag } from "@/components/invoices/InvoiceStatusTag";
import { formatPostalAddress } from "@/lib/domain/invoice-document";
import { APPLIED_LABELS, PAID_LABELS } from "@/lib/domain/status-label";
import { formatDate, formatDateInTimeZone, formatMoney, plural } from "@/lib/format";
import { downloadInvoicePdf } from "@/lib/client/invoice-pdf";
import CustomerFormModal from "@/app/(app)/customers/CustomerFormModal";
import InvoiceDetailDialog from "@/app/(app)/invoices/InvoiceDetailDialog";
import { getInvoiceDocumentAction } from "@/app/(app)/invoices/actions";
import { getCustomerActivityAction, getCustomerTransactionsAction } from "./actions";
import styles from "./customer-detail.module.css";

/**
 * Issued, Due, Total, Paid, Balance due, Status and Actions. Number takes what
 * is left, down to a document number's width; "Receive payment" is the widest
 * thing in Actions.
 */
export const OPEN_INVOICE_FIXED_WIDTHS = [
  COLUMN.DATE,
  COLUMN.DATE,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.STATUS,
  150,
] as const;

/** Date, Type ("Sales receipt" is the longest), Number, Amount and Status. Reference takes the rest. */
export const TRANSACTION_FIXED_WIDTHS = [COLUMN.DATE, 120, COLUMN.CODE, COLUMN.MONEY, COLUMN.STATUS] as const;

const TRANSACTIONS_PAGE_SIZE = 25;

const TRANSACTION_FILTERS = [
  { value: "all", label: "All" },
  { value: "invoice", label: "Invoices" },
  { value: "payment", label: "Payments" },
  { value: "credit_memo", label: "Credit memos" },
  { value: "sales_receipt", label: "Sales receipts" },
] as const satisfies readonly { value: "all" | CustomerTransactionType; label: string }[];
type TransactionFilter = (typeof TRANSACTION_FILTERS)[number]["value"];

/** What "partial" means on each kind of document. */
const STATUS_LABELS: Record<CustomerTransactionType, Readonly<Record<string, string>> | undefined> = {
  invoice: PAID_LABELS,
  payment: APPLIED_LABELS,
  credit_memo: APPLIED_LABELS,
  sales_receipt: undefined,
};

type DateRange = [Dayjs, Dayjs];

const isoDate = (day: Dayjs) => day.format("YYYY-MM-DD");
/** A dialled number keeps its digits and a leading plus; the spaces and brackets are for reading. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const money = (minor: number) => formatMoney(minor, "USD", 2);

interface Props {
  customer: CustomerRow;
  /** Null when the credit status could not be read; the page still opens. */
  credit: CustomerCreditRow | null;
  openInvoices: InvoiceWithCustomer[];
  defaultTermsDays: number;
  currencies: CurrencyRow[];
  usStates: UsStateRow[];
  actors: ActorRow[];
  canWrite: boolean;
  /** invoice.create, as the Invoices page reads it: a Sales user holds it without canWrite. */
  canCreateInvoice: boolean;
  canReadAudit: boolean;
}

/**
 * One customer, collections first (3.0.12): who they are and how to reach
 * them, five figures about what they owe, and the invoices still open, overdue
 * first. Their other documents, contact and credit, and change history are a
 * tab away, each read only when its tab is opened.
 */
export default function CustomerDetailClient({
  customer,
  credit,
  openInvoices,
  defaultTermsDays,
  currencies,
  usStates,
  actors,
  canWrite,
  canCreateInvoice,
  canReadAudit,
}: Props) {
  const { message } = App.useApp();
  const { today, timeZone } = useCompanyClock();

  const receivePaymentHref = `/payments?new=1&customer=${customer.id}`;
  const newInvoiceHref = `/invoices?new=1&customer=${customer.id}`;

  // The customer form is opened here and closed only through its own onClose,
  // which is where it clears what was typed.
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<InvoiceWithCustomer | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  const facts = customerFacts({
    creditTermsDays: customer.credit_terms_days,
    defaultTermsDays,
    credit,
    openInvoices,
    today,
  });
  const sortedOpenInvoices = useMemo(() => sortInvoicesByAttention(openInvoices, today), [openInvoices, today]);

  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const rowMoney = (minor: number, code: string) => formatMoney(minor, code, decimalsOf(code));

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

  // ---------- Transactions: read for the range, when the tab is first opened ----------

  const [txRange, setTxRange] = useState<DateRange | null>(() => [
    dayjs(today).subtract(12, "month"),
    dayjs(today),
  ]);
  const [txType, setTxType] = useState<TransactionFilter>("all");
  const [txRows, setTxRows] = useState<CustomerTransaction[] | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txPageSize, setTxPageSize] = useState<number>(TRANSACTIONS_PAGE_SIZE);
  const txRequest = useRef(0);

  async function loadTransactions(range: DateRange | null) {
    const request = ++txRequest.current;
    setTxLoading(true);
    setTxError(null);
    let rows: CustomerTransaction[] = [];
    let error: string | null = null;
    try {
      const res = await getCustomerTransactionsAction(customer.id, {
        from: range ? isoDate(range[0]) : null,
        to: range ? isoDate(range[1]) : null,
      });
      if (res.ok) rows = res.data ?? [];
      else error = res.error ?? "Failed to load the transactions";
    } catch {
      error = "Failed to load the transactions";
    }
    // Another range was chosen while this one was on its way; that read answers.
    if (request !== txRequest.current) return;
    setTxRows(rows);
    setTxError(error);
    setTxLoading(false);
  }

  function changeRange(value: [Dayjs | null, Dayjs | null] | null) {
    const next = value && value[0] && value[1] ? ([value[0], value[1]] as DateRange) : null;
    setTxRange(next);
    void loadTransactions(next);
  }

  // ---------- Activity: read when the tab is first opened, by roles that may ----------

  const [activity, setActivity] = useState<AuditEntryRow[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  async function loadActivity() {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const res = await getCustomerActivityAction(customer.id);
      setActivity(res.ok ? (res.data ?? []) : []);
      if (!res.ok) setActivityError(res.error ?? "Failed to load the change history");
    } catch {
      setActivity([]);
      setActivityError("Failed to load the change history");
    } finally {
      setActivityLoading(false);
    }
  }

  function openTab(key: string) {
    if (key === "transactions" && txRows === null && !txLoading) void loadTransactions(txRange);
    if (key === "activity" && canReadAudit && activity === null && !activityLoading) {
      void loadActivity();
    }
  }

  // ---------- Header ----------

  const addressLines = formatPostalAddress(customer);
  const place = [customer.city, customer.region].filter(Boolean).join(", ") || addressLines[0] || "";
  const contactMissing = !customer.email || !customer.phone || !place;
  const creditTag = credit ? (
    <Tag color={creditStateColor(credit.status.state)}>{credit.status.label}</Tag>
  ) : null;

  // The page's toolbar: who they are and how to reach them, and on its right
  // what to do about them. Receive payment leads, because the page leads with
  // what is owed.
  const header = (
    <FilterBar
      ariaLabel={`${customer.name}: status, contact and actions`}
      actions={
        <>
          {/* An inactive customer can still pay what they owe. */}
          {canWrite ? (
            <Link href={receivePaymentHref}>
              <Button type="primary">Receive payment</Button>
            </Link>
          ) : null}
          {canCreateInvoice && customer.is_active ? (
            <Link href={newInvoiceHref}>
              <Button icon={<PlusOutlined />}>New invoice</Button>
            </Link>
          ) : null}
          {/* Everyone who can see the customer can see what they owe. */}
          <Link href={`/customers/${customer.id}/statement`}>
            <Button icon={<FileTextOutlined />}>Statement</Button>
          </Link>
          {canWrite ? (
            <RowActionsMenu
              size="middle"
              label={`More actions for ${customer.name}`}
              items={[{ key: "edit", label: "Edit customer", onClick: () => setFormOpen(true) }]}
            />
          ) : null}
        </>
      }
    >
      <div className={styles.identity}>
        <div className={styles.tags}>
          <StatusTag status={customer.is_active ? "active" : "inactive"} />
          {credit && credit.status.reasons.length ? (
            <Tooltip title={credit.status.reasons.join(". ")}>{creditTag}</Tooltip>
          ) : (
            creditTag
          )}
        </div>
        <div className={styles.contact}>
          <span className={styles.contactItem}>
            {customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : "No email"}
          </span>
          <span className={styles.contactItem}>
            {customer.phone ? <a href={telHref(customer.phone)}>{customer.phone}</a> : "No phone"}
          </span>
          <span className={styles.contactItem}>{place || "No address"}</span>
          {canWrite && contactMissing ? (
            <Button type="link" className={styles.inlineLink} onClick={() => setFormOpen(true)}>
              Add contact details
            </Button>
          ) : null}
        </div>
      </div>
    </FilterBar>
  );

  // ---------- Facts strip ----------

  const available: { value: string; note: string; danger: boolean } = !facts.creditKnown
    ? { value: "—", note: "Credit status could not be read", danger: false }
    : facts.limitMinor === null
      ? { value: "—", note: "No limit set", danger: false }
      : {
          value: money(facts.availableMinor ?? 0),
          note: `of a ${money(facts.limitMinor)} limit`,
          danger: (facts.availableMinor ?? 0) < 0,
        };

  const factCells: { key: string; label: ReactNode; value: string; note: string; danger?: boolean }[] = [
    {
      key: "owed",
      label: "Owed now",
      value: money(facts.owedMinor),
      note: facts.openCount ? plural(facts.openCount, "open invoice") : "No open invoices",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: money(facts.overdueMinor),
      note: facts.oldestLateDays === null ? "Nothing overdue" : `oldest ${plural(facts.oldestLateDays, "day")} late`,
      danger: facts.overdueMinor > 0,
    },
    { key: "available", label: "Available credit", ...available },
    {
      key: "terms",
      label: "Terms",
      value: `Net ${facts.termsDays}`,
      note: facts.termsAreDefault ? "Company default" : "Set for this customer",
    },
    {
      key: "dso",
      label: <abbr title="Days sales outstanding">DSO</abbr>,
      value: describeDso(facts.dsoDays, CREDIT_SALES_WINDOW_DAYS),
      note: !facts.creditKnown
        ? "Credit status could not be read"
        : facts.dsoDays === null
          ? `No sales in the last ${CREDIT_SALES_WINDOW_DAYS} days`
          : `${CREDIT_SALES_WINDOW_DAYS}-day sales window`,
    },
  ];

  const factsStrip = (
    <dl className={styles.facts} aria-label={`What ${customer.name} owes`}>
      {factCells.map((cell) => (
        <div key={cell.key} className={styles.fact}>
          <dt className={styles.label}>{cell.label}</dt>
          <dd className={`${styles.value}${cell.danger ? ` ${styles.danger}` : ""}`} title={cell.value}>
            {cell.value}
          </dd>
          <dd className={styles.note}>{cell.note}</dd>
        </div>
      ))}
    </dl>
  );

  // ---------- Open invoices ----------

  const openColumns: TableColumnsType<InvoiceWithCustomer> = [
    {
      ...flexColumn<InvoiceWithCustomer>({
        title: "Number",
        key: "invoice_number",
        floor: COLUMN.CODE,
        render: (_: unknown, r: InvoiceWithCustomer) => (
          <Button type="link" className={styles.number} onClick={() => setViewing(r)}>
            {r.invoice_number ?? "Draft"}
          </Button>
        ),
      }),
      sorter: (a: InvoiceWithCustomer, b: InvoiceWithCustomer) =>
        (a.invoice_number ?? "").localeCompare(b.invoice_number ?? ""),
    },
    {
      title: "Issued",
      dataIndex: "issue_date",
      width: OPEN_INVOICE_FIXED_WIDTHS[0],
      render: (v: string) => formatDate(v),
      sorter: (a, b) => a.issue_date.localeCompare(b.issue_date),
    },
    {
      title: "Due",
      dataIndex: "due_date",
      width: OPEN_INVOICE_FIXED_WIDTHS[1],
      render: (v: string | null) => (v ? formatDate(v) : "—"),
      sorter: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
    },
    {
      title: "Total",
      dataIndex: "total_minor",
      width: OPEN_INVOICE_FIXED_WIDTHS[2],
      align: "right",
      render: (v: number, r) => <span className={styles.money}>{rowMoney(v, r.currency_code)}</span>,
    },
    {
      // Everything that has reduced the balance: payments, and any credit applied.
      title: "Paid",
      key: "paid",
      width: OPEN_INVOICE_FIXED_WIDTHS[3],
      align: "right",
      render: (_: unknown, r) => (
        <span className={styles.money}>{rowMoney(r.total_minor - r.balance_due_minor, r.currency_code)}</span>
      ),
    },
    {
      title: "Balance due",
      dataIndex: "balance_due_minor",
      width: OPEN_INVOICE_FIXED_WIDTHS[4],
      align: "right",
      sorter: (a, b) => a.balance_due_minor - b.balance_due_minor,
      render: (v: number, r) => <span className={styles.money}>{rowMoney(v, r.currency_code)}</span>,
    },
    {
      // As on Invoices: how late or how soon, else the invoice's own status.
      title: "Status",
      dataIndex: "status",
      width: OPEN_INVOICE_FIXED_WIDTHS[5],
      render: (_: InvoiceWithCustomer["status"], r: InvoiceWithCustomer) => (
        <InvoiceStatusTag invoice={r} today={today} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: OPEN_INVOICE_FIXED_WIDTHS[6],
            align: "right" as const,
            render: () => (
              <Link href={receivePaymentHref}>
                <Button size="small">Receive payment</Button>
              </Link>
            ),
          },
        ]
      : []),
  ];

  const openInvoicesTab = (
    <>
      {facts.openCount ? (
        <p className={styles.summary}>
          {`${plural(facts.openCount, "open invoice")} · ${money(facts.owedMinor)} due · overdue first`}
        </p>
      ) : null}
      <DataTable<InvoiceWithCustomer>
        rowKey="id"
        rows={sortedOpenInvoices}
        columns={openColumns}
        emptyTitle="Nothing owed"
        emptyDescription={`${customer.name} has no invoice with a balance left to pay.`}
        emptyAction={
          canCreateInvoice && customer.is_active ? (
            <Link href={newInvoiceHref}>
              <Button icon={<PlusOutlined />}>New invoice</Button>
            </Link>
          ) : undefined
        }
      />
    </>
  );

  // ---------- Transactions ----------

  const visibleTransactions = (txRows ?? []).filter((r) => txType === "all" || r.type === txType);
  const filterLabel = TRANSACTION_FILTERS.find((f) => f.value === txType)?.label ?? "Transactions";
  const showAllDates = () => changeRange(null);

  const txEmpty: { title: string; description?: string; action?: ReactNode } = txError
    ? {
        title: "Transactions could not be loaded",
        description: txError,
        action: <Button onClick={() => void loadTransactions(txRange)}>Try again</Button>,
      }
    : (txRows ?? []).length > 0
      ? {
          title: `No ${filterLabel.toLowerCase()} in this period`,
          action: <Button onClick={() => setTxType("all")}>Show all types</Button>,
        }
      : txRange
        ? {
            title: "No transactions in this period",
            description: `Nothing was invoiced, paid, credited or sold to ${customer.name} between ${formatDate(isoDate(txRange[0]))} and ${formatDate(isoDate(txRange[1]))}.`,
            action: <Button onClick={showAllDates}>Show all dates</Button>,
          }
        : {
            title: "No transactions yet",
            description: `Invoices, payments, credit memos and sales receipts for ${customer.name} appear here.`,
          };

  const transactionColumns: TableColumnsType<CustomerTransaction> = [
    {
      title: "Date",
      dataIndex: "date",
      width: TRANSACTION_FIXED_WIDTHS[0],
      render: (v: string) => formatDate(v),
      sorter: (a, b) => a.date.localeCompare(b.date),
    },
    {
      title: "Type",
      dataIndex: "type",
      width: TRANSACTION_FIXED_WIDTHS[1],
      render: (v: CustomerTransactionType) => transactionTypeLabel(v),
    },
    {
      title: "Number",
      dataIndex: "number",
      width: TRANSACTION_FIXED_WIDTHS[2],
      render: (v: string | null) => <span className={styles.money}>{v ?? "—"}</span>,
    },
    flexColumn<CustomerTransaction>({
      title: "Reference",
      dataIndex: "reference",
      floor: COLUMN.TEXT_MIN,
    }),
    {
      title: "Amount",
      dataIndex: "amountMinor",
      width: TRANSACTION_FIXED_WIDTHS[3],
      align: "right",
      sorter: (a, b) => a.amountMinor - b.amountMinor,
      render: (v: number, r) => <span className={styles.money}>{rowMoney(v, r.currencyCode)}</span>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: TRANSACTION_FIXED_WIDTHS[4],
      render: (v: string, r) => <StatusTag status={v} labels={STATUS_LABELS[r.type]} />,
    },
  ];

  const transactionsTab = (
    <>
      <div className={styles.toolbar}>
        <Segmented<TransactionFilter>
          aria-label="Show transactions of type"
          options={TRANSACTION_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          value={txType}
          onChange={setTxType}
        />
        <DatePicker.RangePicker aria-label="Transaction date range" format="MM/DD/YYYY" value={txRange} onChange={changeRange} />
      </div>
      <DataTable<CustomerTransaction>
        rowKey={(r) => `${r.type}:${r.id}`}
        rows={visibleTransactions}
        columns={transactionColumns}
        loading={txLoading}
        pagination={clientTablePagination(txPageSize, setTxPageSize, pageSizeOptionsFor(TRANSACTIONS_PAGE_SIZE))}
        emptyTitle={txEmpty.title}
        emptyDescription={txEmpty.description}
        emptyAction={txEmpty.action}
      />
    </>
  );

  // ---------- Contact & credit ----------

  const editButton = (what: string) =>
    canWrite ? (
      <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${what}`} onClick={() => setFormOpen(true)}>
        Edit
      </Button>
    ) : null;

  const contactItems: DescriptionsProps["items"] = [
    { key: "contact_name", label: "Contact person", children: customer.contact_name || "Not recorded" },
    {
      key: "email",
      label: "Email",
      children: customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : "No email",
    },
    {
      key: "phone",
      label: "Phone",
      children: customer.phone ? <a href={telHref(customer.phone)}>{customer.phone}</a> : "No phone",
    },
    {
      key: "address",
      label: "Address",
      children: addressLines.length
        ? addressLines.map((line, i) => <div key={`${i}:${line}`}>{line}</div>)
        : "No address",
    },
  ];

  const creditItems: DescriptionsProps["items"] = [
    {
      key: "limit",
      label: "Limit",
      children:
        customer.credit_limit_minor === null
          ? "Not set"
          : customer.credit_limit_minor === 0
            ? `${money(0)} (cash only)`
            : money(customer.credit_limit_minor),
    },
    {
      key: "terms",
      label: "Terms",
      children:
        customer.credit_terms_days === null
          ? `Net ${defaultTermsDays} (company default)`
          : `Net ${customer.credit_terms_days}`,
    },
    { key: "hold", label: "Hold", children: customer.credit_hold ? "Yes" : "No" },
    {
      key: "reviewed",
      label: "Last reviewed",
      children: customer.credit_reviewed_at ? formatDateInTimeZone(customer.credit_reviewed_at, timeZone) : "Never",
    },
    { key: "review_note", label: "Review note", children: customer.credit_review_note || "—" },
  ];

  const contactTab = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Descriptions
          bordered
          column={1}
          size="small"
          title="Contact"
          extra={editButton("contact details")}
          items={contactItems}
        />
      </Col>
      <Col xs={24} lg={12}>
        <Descriptions
          bordered
          column={1}
          size="small"
          title="Credit"
          extra={editButton("credit")}
          items={creditItems}
        />
      </Col>
    </Row>
  );

  // ---------- Activity ----------

  const activityTab = canReadAudit ? (
    <>
      <p className={styles.summary}>The latest changes to this customer&apos;s record, newest first (up to 200).</p>
      {activityError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="The change history could not be loaded"
          description={activityError}
          action={
            <Button size="small" onClick={() => void loadActivity()}>
              Try again
            </Button>
          }
        />
      ) : null}
      <ChangeHistoryTable entries={activity ?? []} loading={activityLoading} currencyFallback="USD" />
    </>
  ) : (
    <ChangeHistoryUnavailable subject="this customer" />
  );

  return (
    <div>
      {header}
      {factsStrip}
      <Tabs
        defaultActiveKey="open"
        onChange={openTab}
        items={[
          {
            key: "open",
            label: (
              <span>
                Open invoices<span className={styles.tabCount}>{facts.openCount}</span>
              </span>
            ),
            children: openInvoicesTab,
          },
          { key: "transactions", label: "Transactions", children: transactionsTab },
          { key: "contact", label: "Contact & credit", children: contactTab },
          { key: "activity", label: "Activity", children: activityTab },
        ]}
      />

      <InvoiceDetailDialog
        invoice={viewing}
        currencies={currencies}
        actors={actors}
        canReadAudit={canReadAudit}
        linkCustomer={false}
        onClose={() => setViewing(null)}
        onDownloadPdf={downloadPdf}
        pdfBusy={pdfId === viewing?.id}
      />

      <CustomerFormModal
        open={formOpen}
        customer={customer}
        usStates={usStates}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          // The edit is in the change history now; a history already shown reads it again.
          if (canReadAudit && activity !== null) void loadActivity();
        }}
      />
    </div>
  );
}
