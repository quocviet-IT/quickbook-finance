"use client";
import { useMemo, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import type { ExpenseWithVendor } from "@/lib/services/payables";
import { recordExpenseAction, voidExpenseAction } from "./actions";

interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number;
}

export default function ExpensesClient({
  expenses,
  vendors,
  expenseAccounts,
  paymentAccounts,
  currencies,
  canWrite,
}: {
  expenses: ExpenseWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  paymentAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [currency, setCurrency] = useState<string>(currencies.find((c) => c.is_base)?.code ?? "USD");

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function submit() {
    const values = await form.validateFields();
    const lines = (values.lines as LineForm[]).map((l) => ({
      description: l.description ?? "",
      expense_account_id: l.expense_account_id,
      amount_minor: Math.round((l.amount ?? 0) * 10 ** decimals),
    }));
    setSaving(true);
    const res = await recordExpenseAction({
      vendor_id: values.vendor_id ?? null,
      payment_account_id: values.payment_account_id,
      currency_code: currency,
      expense_date: values.expense_date ? values.expense_date.format("YYYY-MM-DD") : undefined,
      memo: values.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Expense recorded");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to record expense");
    }
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this expense?",
      content: "This reverses its journal entry.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidExpenseAction(id);
        if (res.ok) message.success("Expense voided");
        else message.error(res.error ?? "Failed to void expense");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New expense
          </Button>
        )}
      </Space>
      <Table<ExpenseWithVendor>
        rowKey="id"
        dataSource={expenses}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Expense #", dataIndex: "expense_number", render: (v) => v ?? "—" },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Date", dataIndex: "expense_date" },
          { title: "Total", dataIndex: "total_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "green"}>{s}</Tag> },
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
        title="New expense"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record"
        width={720}
      >
        <Form form={form} layout="vertical" initialValues={{ lines: [{}] }}>
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_id" label="Vendor (optional)">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 220 }}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="payment_account_id"
              label="Paid from"
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
            <Form.Item name="expense_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Description" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "expense_account_id"]}
                      rules={[{ required: true, message: "Account" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Expense account"
                        style={{ width: 220 }}
                        showSearch
                        optionFilterProp="label"
                        options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      rules={[{ required: true, message: "Amount" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={0} precision={decimals} placeholder="Amount" style={{ width: 140 }} />
                    </Form.Item>
                    {fields.length > 1 && <Button type="link" danger onClick={() => remove(field.name)}>Remove</Button>}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  Add line
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="memo" label="Memo" style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
