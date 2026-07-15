"use client";
import { useMemo, useState } from "react";
import {
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
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type {
  AccountRow,
  CurrencyRow,
  TaxCodeRow,
  CustomerRow,
  InvoiceStatus,
  InvoiceLineRow,
} from "@/lib/db/types";
import type { InvoiceWithCustomer } from "@/lib/services/invoicing";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import {
  createInvoiceAction,
  createCustomerAction,
  issueInvoiceAction,
  voidInvoiceAction,
  getInvoiceLinesAction,
} from "./actions";

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
}

export default function InvoicesClient({
  invoices,
  customers,
  incomeAccounts,
  taxCodes,
  currencies,
  canWrite,
}: {
  invoices: InvoiceWithCustomer[];
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Inline customer creation
  const [custOpen, setCustOpen] = useState(false);
  const [custForm] = Form.useForm();
  const [localCustomers, setLocalCustomers] = useState<CustomerRow[]>(customers);

  // View lines
  const [linesOpen, setLinesOpen] = useState(false);
  const [viewLines, setViewLines] = useState<InvoiceLineRow[]>([]);
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithCustomer | null>(null);

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

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ currency_code: baseCurrency, lines: [{ quantity: 1 }] });
    setOpen(true);
  }

  async function submitCustomer() {
    const v = await custForm.validateFields();
    const res = await createCustomerAction(v);
    if (res.ok && res.data) {
      const c: CustomerRow = {
        id: res.data.id, name: res.data.name, email: null, currency_code: null,
        is_active: true, created_at: "", updated_at: "",
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
    setLinesOpen(true);
    const res = await getInvoiceLinesAction(inv.id);
    if (res.ok && res.data) setViewLines(res.data);
    else message.error(res.error ?? "Failed to load lines");
  }

  const columns: TableColumnsType<InvoiceWithCustomer> = [
    { title: "Number", dataIndex: "invoice_number", width: 120, render: (n) => n ?? <Tag>draft</Tag> },
    { title: "Customer", dataIndex: "customer_name" },
    { title: "Issue date", dataIndex: "issue_date", width: 120 },
    {
      title: "Total",
      dataIndex: "total_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Balance due",
      dataIndex: "balance_due_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (s: InvoiceStatus) => <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 230,
      render: (_: unknown, r) => (
        <Space>
          <Button size="small" onClick={() => viewInvoiceLines(r)}>
            View
          </Button>
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
        </Space>
      ),
    },
  ];

  return (
    <div>
      {canWrite && (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New invoice
          </Button>
        </Space>
      )}

      <Table<InvoiceWithCustomer>
        rowKey="id"
        columns={columns}
        dataSource={invoices}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
        sticky
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
        <Form form={form} layout="vertical" requiredMark={false}>
          <Space align="end" wrap>
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]} style={{ minWidth: 280 }}>
              <Select
                showSearch
                filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                placeholder="Select a customer"
                options={localCustomers.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
            <Form.Item label=" ">
              <Button onClick={() => setCustOpen(true)}>+ New customer</Button>
            </Form.Item>
            <Form.Item name="currency_code" label="Currency" rules={[{ required: true }]} style={{ width: 150 }}>
              <Select options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
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
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0, width: 200 }}>
                      <Input placeholder="Description" />
                    </Form.Item>
                    <Form.Item name={[field.name, "quantity"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Qty" }]}>
                      <InputNumber placeholder="Qty" min={0} style={{ width: 90 }} />
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
                    <Form.Item name={[field.name, "tax_code_id"]} style={{ marginBottom: 0, width: 160 }}>
                      <Select
                        allowClear
                        placeholder="Tax"
                        options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate_percent}%)` }))}
                      />
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(field.name)} style={{ color: "#c00" }} />
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
        width={720}
      >
        <Table<InvoiceLineRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={viewLines}
          columns={[
            { title: "Description", dataIndex: "description" },
            { title: "Qty", dataIndex: "quantity", width: 70, align: "right" },
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
    </div>
  );
}
