"use client";
import { useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, CustomerRow, InvoiceRow, PaymentRow, PaymentStatus } from "@/lib/db/types";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { recordPaymentAction, getOpenInvoicesAction } from "./actions";

const STATUS: Record<PaymentStatus, { text: string; color: string }> = {
  unapplied: { text: "Unapplied", color: "orange" },
  partial: { text: "Partially applied", color: "gold" },
  applied: { text: "Applied", color: "green" },
  void: { text: "Void", color: "red" },
};

export default function PaymentsClient({
  payments,
  customers,
  depositAccounts,
  currencies,
  canWrite,
}: {
  payments: (PaymentRow & { customer_name: string })[];
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<InvoiceRow[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // invoiceId -> major units

  const baseCurrency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const currency: string = Form.useWatch("currency_code", form) ?? baseCurrency;
  const amount: number = Form.useWatch("amount", form) ?? 0;

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ currency_code: baseCurrency });
    setOpenInvoices([]);
    setAlloc({});
    setOpen(true);
  }

  async function onCustomerChange(customerId: string) {
    setAlloc({});
    const res = await getOpenInvoicesAction(customerId);
    if (res.ok && res.data) setOpenInvoices(res.data);
    else {
      setOpenInvoices([]);
      message.error(res.error ?? "Failed to load open invoices");
    }
  }

  function autoApply() {
    let remaining = amount;
    const next: Record<string, number> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const dueMajor = inv.balance_due_minor / 10 ** decimalsOf(inv.currency_code);
      const take = Math.min(dueMajor, remaining);
      next[inv.id] = Number(take.toFixed(decimalsOf(inv.currency_code)));
      remaining -= take;
    }
    setAlloc(next);
  }

  const allocTotal = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);

  async function submit() {
    const v = await form.validateFields();
    const dec = decimalsOf(v.currency_code);
    const allocations = Object.entries(alloc)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([invoice_id, amt]) => ({ invoice_id, amount_minor: toMinorUnits(amt, dec) }));

    if (allocTotal > (v.amount ?? 0) + 1e-9) {
      message.error("Allocations exceed the payment amount");
      return;
    }

    setSaving(true);
    const res = await recordPaymentAction({
      customer_id: v.customer_id,
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      currency_code: v.currency_code,
      amount_minor: toMinorUnits(Number(v.amount), dec),
      deposit_account_id: v.deposit_account_id,
      method: v.method ?? null,
      memo: v.memo ?? null,
      allocations,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Payment recorded and posted to the ledger");
      setOpen(false);
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  const columns: TableColumnsType<PaymentRow & { customer_name: string }> = [
    { title: "Number", dataIndex: "payment_number", width: 120, render: (n) => n ?? "—" },
    { title: "Customer", dataIndex: "customer_name" },
    { title: "Date", dataIndex: "payment_date", width: 120 },
    { title: "Method", dataIndex: "method", width: 130, render: (m) => m ?? "—" },
    {
      title: "Amount",
      dataIndex: "amount_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Unapplied",
      dataIndex: "unapplied_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 150,
      render: (s: PaymentStatus) => <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag>,
    },
  ];

  return (
    <div>
      {canWrite && (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Receive payment
          </Button>
        </Space>
      )}

      <Table rowKey="id" columns={columns} dataSource={payments} size="small" pagination={{ pageSize: 20 }} sticky />

      <Modal
        title="Receive payment"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record payment"
        cancelText="Cancel"
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Space wrap align="end">
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]} style={{ minWidth: 280 }}>
              <Select
                showSearch
                filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                placeholder="Select a customer"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
                onChange={onCustomerChange}
              />
            </Form.Item>
            <Form.Item name="currency_code" label="Currency" rules={[{ required: true }]} style={{ width: 120 }}>
              <Select options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
            </Form.Item>
            <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter amount" }]}>
              <InputNumber min={0} step={0.01} prefix="$" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="payment_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="deposit_account_id" label="Deposit to" rules={[{ required: true, message: "Select an account" }]} style={{ minWidth: 280 }}>
              <Select
                placeholder="Bank / cash account"
                options={depositAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
              />
            </Form.Item>
            <Form.Item name="method" label="Method" style={{ width: 180 }}>
              <Select
                allowClear
                placeholder="Method"
                options={["cash", "bank_transfer", "card", "check"].map((m) => ({ value: m, label: m }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <Typography.Text strong>Apply to open invoices</Typography.Text>
            <Button size="small" onClick={autoApply} disabled={!openInvoices.length}>
              Auto apply
            </Button>
          </Space>
          <Table<InvoiceRow>
            rowKey="id"
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            dataSource={openInvoices}
            locale={{ emptyText: "No open invoices for this customer" }}
            columns={[
              { title: "Invoice", dataIndex: "invoice_number", render: (n) => n ?? "—" },
              {
                title: "Balance due",
                dataIndex: "balance_due_minor",
                width: 140,
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
              },
              {
                title: "Apply",
                key: "apply",
                width: 160,
                render: (_: unknown, r) => (
                  <InputNumber
                    min={0}
                    step={0.01}
                    prefix="$"
                    style={{ width: 140 }}
                    value={alloc[r.id]}
                    max={r.balance_due_minor / 10 ** decimalsOf(r.currency_code)}
                    onChange={(val) => setAlloc((prev) => ({ ...prev, [r.id]: Number(val ?? 0) }))}
                  />
                ),
              },
            ]}
          />

          <div style={{ textAlign: "right", marginTop: 8 }}>
            <Typography.Text type={allocTotal > amount + 1e-9 ? "danger" : "secondary"}>
              Allocated {formatMoney(toMinorUnits(allocTotal, decimalsOf(currency)), currency, decimalsOf(currency))} of{" "}
              {formatMoney(toMinorUnits(amount, decimalsOf(currency)), currency, decimalsOf(currency))}
            </Typography.Text>
          </div>

          <Form.Item name="memo" label="Memo" style={{ marginTop: 8 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
