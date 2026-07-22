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
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, VendorRow, ItemRow } from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import { itemToBillLineDefaults } from "@/lib/domain/items";
import { createBillAction, postBillAction, voidBillAction } from "./actions";

const STATUS_COLOR: Record<string, string> = {
  draft: "default",
  open: "blue",
  partial: "gold",
  paid: "green",
  void: "red",
};

interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number; // decimal, converted to minor on submit
  item_id?: string | null;
}

export default function BillsClient({
  bills,
  vendors,
  expenseAccounts,
  currencies,
  items,
  canWrite,
}: {
  bills: BillWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
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
      item_id: l.item_id ?? null,
    }));
    setSaving(true);
    const res = await createBillAction({
      vendor_id: values.vendor_id,
      vendor_ref: values.vendor_ref ?? null,
      currency_code: currency,
      bill_date: values.bill_date ? values.bill_date.format("YYYY-MM-DD") : undefined,
      due_date: values.due_date ? values.due_date.format("YYYY-MM-DD") : null,
      memo: values.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Draft bill created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create bill");
    }
  }

  async function post(id: string) {
    const res = await postBillAction(id);
    if (res.ok) message.success("Bill posted");
    else message.error(res.error ?? "Failed to post bill");
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill?",
      content: "This reverses its journal entry. Bills with payments applied cannot be voided.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillAction(id);
        if (res.ok) message.success("Bill voided");
        else message.error(res.error ?? "Failed to void bill");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New bill
          </Button>
        )}
      </Space>
      <Table<BillWithVendor>
        rowKey="id"
        dataSource={bills}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Bill #", dataIndex: "bill_number", render: (v) => v ?? <Tag>draft</Tag> },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Ref", dataIndex: "vendor_ref", render: (v) => v ?? "—" },
          { title: "Date", dataIndex: "bill_date" },
          { title: "Due", dataIndex: "due_date", render: (v) => v ?? "—" },
          {
            title: "Total",
            dataIndex: "total_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Balance",
            dataIndex: "balance_due_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite ? (
                <Space>
                  {r.status === "draft" && (
                    <Button size="small" type="link" onClick={() => post(r.id)}>
                      Post
                    </Button>
                  )}
                  {r.status !== "void" && r.status !== "paid" && (
                    <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                      Void
                    </Button>
                  )}
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title="New bill"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Create draft"
        width={720}
      >
        <Form form={form} layout="vertical" initialValues={{ lines: [{}] }}>
          <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_ref" label="Vendor ref #">
              <Input placeholder="Vendor's invoice #" />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                value={currency}
                style={{ width: 120 }}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="bill_date" label="Bill date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="due_date" label="Due date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        style={{ width: 180 }}
                        optionFilterProp="label"
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToBillLineDefaults(it);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "expense_account_id"], value: d.expense_account_id ?? undefined },
                            { name: ["lines", field.name, "amount"], value: d.amount_minor / 10 ** decimals },
                          ]);
                        }}
                      />
                    </Form.Item>
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
