"use client";
import { useMemo, useState } from "react";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, BillPaymentRow, BillRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import { openBillsForVendorAction, payBillsAction, voidBillPaymentAction } from "./actions";

export default function PayBillsClient({
  payments,
  vendors,
  paymentAccounts,
  currencies,
  canWrite,
}: {
  payments: (BillPaymentRow & { vendor_name: string })[];
  vendors: VendorRow[];
  paymentAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [currency, setCurrency] = useState<string>(currencies.find((c) => c.is_base)?.code ?? "USD");
  const [openBills, setOpenBills] = useState<BillRow[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // bill_id -> decimal amount

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function onVendorChange(vendorId: string) {
    setAlloc({});
    const res = await openBillsForVendorAction(vendorId);
    if (res.ok) setOpenBills(res.data ?? []);
    else message.error(res.error ?? "Failed to load open bills");
  }

  const allocTotalMinor = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + Math.round((v ?? 0) * 10 ** decimals), 0),
    [alloc, decimals],
  );

  async function submit() {
    const values = await form.validateFields();
    const allocations = openBills
      .map((b) => ({ bill_id: b.id, amount_minor: Math.round((alloc[b.id] ?? 0) * 10 ** decimals) }))
      .filter((a) => a.amount_minor > 0);
    setSaving(true);
    const res = await payBillsAction({
      vendor_id: values.vendor_id,
      payment_date: values.payment_date ? values.payment_date.format("YYYY-MM-DD") : undefined,
      currency_code: currency,
      amount_minor: Math.round((values.amount ?? 0) * 10 ** decimals),
      payment_account_id: values.payment_account_id,
      method: values.method ?? null,
      allocations,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Payment recorded");
      setOpen(false);
      form.resetFields();
      setOpenBills([]);
      setAlloc({});
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill payment?",
      content: "This reverses the journal entry and restores the bill balances.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillPaymentAction(id);
        if (res.ok) message.success("Payment voided");
        else message.error(res.error ?? "Failed to void payment");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Pay bills
          </Button>
        )}
      </Space>
      <Table<BillPaymentRow & { vendor_name: string }>
        rowKey="id"
        dataSource={payments}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Payment #", dataIndex: "payment_number", render: (v) => v ?? "—" },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Date", dataIndex: "payment_date" },
          { title: "Amount", dataIndex: "amount_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Unapplied", dataIndex: "unapplied_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "blue"}>{s}</Tag> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite && r.status !== "void" ? (
                <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                  Void
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        title="Pay bills"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record payment"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                onChange={onVendorChange}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="payment_account_id"
              label="Pay from"
              rules={[{ required: true, message: "Select a payment account" }]}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                options={paymentAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
              />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                value={currency}
                style={{ width: 120 }}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="payment_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="amount" label="Payment amount" rules={[{ required: true, message: "Enter an amount" }]}>
            <InputNumber min={0} precision={decimals} style={{ width: 200 }} />
          </Form.Item>

          <Typography.Text strong>Open bills</Typography.Text>
          <Table<BillRow>
            rowKey="id"
            dataSource={openBills}
            size="small"
            pagination={false}
            scroll={{ x: "max-content" }}
            style={{ marginTop: 8 }}
            columns={[
              { title: "Bill #", dataIndex: "bill_number", render: (v) => v ?? "—" },
              { title: "Date", dataIndex: "bill_date" },
              { title: "Balance", dataIndex: "balance_due_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
              {
                title: "Payment",
                key: "pay",
                render: (_, r) => (
                  <InputNumber
                    min={0}
                    max={r.balance_due_minor / 10 ** decimals}
                    precision={decimals}
                    value={alloc[r.id]}
                    onChange={(v) => setAlloc((prev) => ({ ...prev, [r.id]: Number(v ?? 0) }))}
                  />
                ),
              },
            ]}
          />
          <Typography.Paragraph style={{ marginTop: 8 }}>
            Allocated: {(allocTotalMinor / 10 ** decimals).toFixed(decimals)} {currency}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
