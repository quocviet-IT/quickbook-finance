"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  DeleteOutlined,
  EyeOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
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
import type { InvoiceWithCustomer } from "@/lib/services/invoicing";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";
import { documentAttribution, formatAuditTimestamp } from "@/lib/domain/audit";
import {
  defaultTaxCodeForState,
  groupTaxCodesByState,
  taxCodeLabel,
} from "@/lib/domain/tax-jurisdiction";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import {
  createInvoiceAction,
  createCustomerAction,
  issueInvoiceAction,
  voidInvoiceAction,
  getInvoiceLinesAction,
  getInvoiceAuditAction,
  getInvoiceDocumentAction,
} from "./actions";
import { downloadInvoicePdf } from "@/lib/client/invoice-pdf";
import WriteOffModal from "../settlements/WriteOffModal";

const STATUS: Record<InvoiceStatus, { text: string; color: string }> = {
  draft: { text: "Draft", color: "default" },
  issued: { text: "Issued", color: "blue" },
  partial: { text: "Partially paid", color: "gold" },
  paid: { text: "Paid", color: "green" },
  void: { text: "Void", color: "red" },
};

interface LineForm {
  description?: string;
  quantity?: number;
  unit_price?: number; // major units
  income_account_id?: string;
  tax_code_id?: string | null;
  item_id?: string | null;
}

export default function InvoicesClient({
  initialCreateOpen,
  initialQueue,
  invoices,
  customers,
  incomeAccounts,
  expenseAccounts,
  taxCodes,
  currencies,
  items,
  canWrite,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  canReadAudit,
  actors,
  usStates,
  sequenceWarning,
  scannerConfigured,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  initialQueue: { asOf: string; focusId: string | null } | null;
  invoices: InvoiceWithCustomer[];
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  canWrite: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  /** Gates the change history block; the RPC behind it refuses the call anyway. */
  canReadAudit: boolean;
  actors: ActorRow[];
  usStates: { code: string; name: string }[];
  /** Set when the invoice sequence has a break nobody has accounted for. */
  sequenceWarning: string | null;
  scannerConfigured: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(initialCreateOpen);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<InvoiceWithCustomer | null>(null);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);

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

  const baseCurrency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const taxRateOf = (id?: string | null) =>
    id ? Number(taxCodes.find((t) => t.id === id)?.rate_percent ?? 0) : 0;

  const currency: string = Form.useWatch("currency_code", form) ?? baseCurrency;
  const watchedLines: LineForm[] = Form.useWatch("lines", form) ?? [];

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

  const visibleInvoices = useMemo(() => {
    if (!initialQueue) return invoices;
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
  }, [initialQueue, invoices]);

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ currency_code: baseCurrency, lines: [{ quantity: 1 }] });
    setOpen(true);
  }

  /**
   * Most states tax a sale where it is delivered, so picking a customer fills
   * the rate registered in that customer's state — on lines that have none yet,
   * never over a rate somebody chose. Nothing is filled where the company has
   * no rate there, or where its state has more than one: neither is a default.
   */
  function applyCustomerTaxRate(customerId: string) {
    const customer = localCustomers.find((c) => c.id === customerId);
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
        country: null, created_at: "", updated_at: "",
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
    const v = await form.validateFields();
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
    const res = await createInvoiceAction({
      customer_id: v.customer_id,
      currency_code: v.currency_code,
      issue_date: v.issue_date ? v.issue_date.format("YYYY-MM-DD") : undefined,
      due_date: v.due_date ? v.due_date.format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Draft invoice created");
      setOpen(false);
    } else {
      message.error(res.error ?? "Failed to create invoice");
    }
  }

  async function issue(id: string) {
    setBusyId(id);
    const res = await issueInvoiceAction(id);
    setBusyId(null);
    if (res.ok) message.success("Invoice issued and posted to the ledger");
    else message.error(res.error ?? "Failed to issue invoice");
  }

  async function voidInv(id: string) {
    setBusyId(id);
    const res = await voidInvoiceAction(id);
    setBusyId(null);
    if (res.ok) message.success("Invoice voided");
    else message.error(res.error ?? "Failed to void invoice");
  }

  async function viewInvoiceLines(inv: InvoiceWithCustomer) {
    setViewInvoice(inv);
    setViewLines([]);
    setViewAudit([]);
    setLinesOpen(true);
    const res = await getInvoiceLinesAction(inv.id);
    if (res.ok && res.data) setViewLines(res.data);
    else message.error(res.error ?? "Failed to load lines");
    if (!canReadAudit) return;
    setAuditLoading(true);
    const trail = await getInvoiceAuditAction(inv.id);
    setAuditLoading(false);
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
      downloadInvoicePdf(res.data, inv.invoice_number, inv.issue_date);
    } finally {
      setPdfId(null);
    }
  }

  const columns: TableColumnsType<InvoiceWithCustomer> = [
    {
      title: "Number",
      dataIndex: "invoice_number",
      width: 120,
      // Drafts have no number yet and sort to the top; everything else runs in
      // sequence, which is how a break becomes visible while scrolling.
      defaultSortOrder: "descend",
      sorter: (a, b) => (a.invoice_number ?? "￿").localeCompare(b.invoice_number ?? "￿"),
      render: (n) => n ?? <Tag>draft</Tag>,
    },
    {
      title: "Customer",
      dataIndex: "customer_name",
      sorter: (a, b) => a.customer_name.localeCompare(b.customer_name),
    },
    {
      title: "Issue date",
      dataIndex: "issue_date",
      width: 120,
      sorter: (a, b) => a.issue_date.localeCompare(b.issue_date),
    },
    {
      title: "Total",
      dataIndex: "total_minor",
      width: 130,
      align: "right",
      sorter: (a, b) => a.total_minor - b.total_minor,
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Balance due",
      dataIndex: "balance_due_minor",
      width: 130,
      align: "right",
      sorter: (a, b) => a.balance_due_minor - b.balance_due_minor,
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (s: InvoiceStatus) => <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag>,
    },
    {
      // Who made this invoice and when, on the row itself: the first question an
      // auditor asks of a document, and one it should not take a click to answer.
      title: "Created",
      dataIndex: "created_at",
      width: 180,
      render: (_: string, r) => {
        const attribution = documentAttribution(r, directory);
        return (
          <div>
            <div>{formatAuditTimestamp(attribution.createdAt).slice(0, 16)}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {attribution.createdBy}
              {attribution.modifiedAt ? " · edited" : ""}
            </Typography.Text>
          </div>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 230,
      render: (_: unknown, r) => (
        <Space>
          <IconActionButton
            label="View invoice lines"
            icon={<EyeOutlined />}
            onClick={() => viewInvoiceLines(r)}
          />
          <IconActionButton
            label="Download PDF"
            icon={<FilePdfOutlined />}
            loading={pdfId === r.id}
            onClick={() => downloadPdf(r)}
          />
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
          {canWrite && r.status === "draft" && (
            <Button size="small" type="primary" loading={busyId === r.id} onClick={() => issue(r.id)}>
              Issue
            </Button>
          )}
          {canWrite && r.status !== "void" && r.status !== "paid" && (
            <Popconfirm title="Void this invoice?" onConfirm={() => voidInv(r.id)} okText="Void" cancelText="Cancel">
              <Button size="small" danger loading={busyId === r.id}>
                Void
              </Button>
            </Popconfirm>
          )}
          {canWrite && (r.status === "issued" || r.status === "partial") && (
            <Button size="small" onClick={() => setWriteOffFor(r)}>
              Write off
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
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

      <FilterBar
        resultCount={visibleInvoices.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New invoice
            </Button>
          ) : null
        }
      >
        {initialQueue ? (
          <div className="accounting-queue-filter">
            <Tag color="red">Work queue · overdue invoices</Tag>
            <Typography.Text type="secondary">As of {initialQueue.asOf}</Typography.Text>
            <Button onClick={() => router.push("/invoices")}>Show all</Button>
          </div>
        ) : null}
      </FilterBar>

      <DataTable<InvoiceWithCustomer>
        rowKey="id"
        columns={columns}
        dataSource={visibleInvoices}
        rowClassName={(invoice) =>
          invoice.id === initialQueue?.focusId ? "accounting-data-row--focused" : ""
        }
        sticky
        emptyTitle={initialQueue ? "No overdue invoices" : "No invoices yet"}
        emptyDescription={
          initialQueue
            ? "Customer balances are current as of the selected work queue date."
            : "Create a draft invoice, review it, then issue it to the ledger."
        }
      />

      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />

      {/* Create invoice */}
      <Modal
        title="New invoice"
        open={open}
        onOk={submitInvoice}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Save draft"
        cancelText="Cancel"
        width={860}
        destroyOnHidden
      >
        {/* Defaults live here too, so opening straight from the New menu matches
            what the New invoice button sets up. */}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ currency_code: baseCurrency, lines: [{ quantity: 1 }] }}
        >
          <Space align="end" wrap>
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]} style={{ minWidth: 280 }}>
              <Select
                showSearch
                filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                placeholder="Select a customer"
                options={localCustomers.map((c) => ({ value: c.id, label: c.name }))}
                onChange={applyCustomerTaxRate}
              />
            </Form.Item>
            <Form.Item label=" ">
              <Button onClick={() => setCustOpen(true)}>+ New customer</Button>
            </Form.Item>
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

          <Typography.Text strong>Line items</Typography.Text>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0, width: 190 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        optionFilterProp="label"
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToInvoiceLineDefaults(it);
                          const dec = decimalsOf(form.getFieldValue("currency_code") ?? baseCurrency);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "unit_price"], value: d.unit_price_minor / 10 ** dec },
                            { name: ["lines", field.name, "income_account_id"], value: d.income_account_id ?? undefined },
                            { name: ["lines", field.name, "tax_code_id"], value: d.tax_code_id ?? undefined },
                          ]);
                        }}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0, width: 200 }}>
                      <Input placeholder="Description" />
                    </Form.Item>
                    <Form.Item name={[field.name, "quantity"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Quantity" }]}>
                      <InputNumber placeholder="Quantity" min={0} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, "unit_price"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Price" }]}>
                      <InputNumber placeholder="Unit price" min={0} step={0.01} style={{ width: 130 }} prefix="$" />
                    </Form.Item>
                    <Form.Item name={[field.name, "income_account_id"]} style={{ marginBottom: 0, width: 200 }} rules={[{ required: true, message: "Account" }]}>
                      <Select
                        placeholder="Income account"
                        options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "tax_code_id"]} style={{ marginBottom: 0, width: 190 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Tax"
                        optionFilterProp="label"
                        options={taxOptions}
                      />
                    </Form.Item>
                    <IconActionButton
                      label="Remove invoice line"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />} block>
                  Add line
                </Button>
              </div>
            )}
          </Form.List>

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
        <Form form={custForm} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* View lines */}
      <Modal
        title={`Invoice ${viewInvoice?.invoice_number ?? "(draft)"}`}
        open={linesOpen}
        onCancel={() => setLinesOpen(false)}
        footer={null}
        width={820}
      >
        {viewInvoice ? (
          <DocumentAuditTrail
            record={viewInvoice}
            directory={directory}
            entries={viewAudit}
            loading={auditLoading}
            canReadAudit={canReadAudit}
          />
        ) : null}

        <Table<InvoiceLineRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={viewLines}
          columns={[
            { title: "Description", dataIndex: "description" },
            { title: "Quantity", dataIndex: "quantity", width: 90, align: "right" },
            {
              title: "Unit price",
              dataIndex: "unit_price_minor",
              width: 110,
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
            {
              title: "Subtotal",
              dataIndex: "line_subtotal_minor",
              width: 110,
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
            {
              title: "Tax",
              dataIndex: "line_tax_minor",
              width: 100,
              align: "right",
              render: (v: number) =>
                viewInvoice ? formatMoney(v, viewInvoice.currency_code, decimalsOf(viewInvoice.currency_code)) : v,
            },
          ]}
        />
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
