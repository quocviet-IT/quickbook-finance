"use client";
import { useState } from "react";
import { App, Button, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { createItemAction, updateItemAction, setItemActiveAction } from "./actions";

interface Props {
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
}

export default function ItemsClient({ items, incomeAccounts, expenseAccounts, taxCodes, canWrite }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [form] = Form.useForm();
  const isSold = Form.useWatch("is_sold", form);
  const isPurchased = Form.useWatch("is_purchased", form);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_sold: true, is_purchased: false, sales_price: 0, purchase_cost: 0 });
    setOpen(true);
  }

  function openEdit(it: ItemRow) {
    setEditing(it);
    form.setFieldsValue({
      item_code: it.item_code ?? "",
      name: it.name,
      description: it.description,
      is_sold: it.is_sold,
      sales_price: it.sales_price_minor / 100,
      income_account_id: it.income_account_id ?? undefined,
      sales_tax_code_id: it.sales_tax_code_id ?? undefined,
      is_purchased: it.is_purchased,
      purchase_cost: it.purchase_cost_minor / 100,
      expense_account_id: it.expense_account_id ?? undefined,
    });
    setOpen(true);
  }

  async function submit() {
    const v = await form.validateFields();
    const payload = {
      item_code: v.item_code || null,
      name: v.name,
      description: v.description ?? "",
      is_sold: !!v.is_sold,
      sales_price_minor: Math.round((v.sales_price ?? 0) * 100),
      income_account_id: v.income_account_id ?? null,
      sales_tax_code_id: v.sales_tax_code_id ?? null,
      is_purchased: !!v.is_purchased,
      purchase_cost_minor: Math.round((v.purchase_cost ?? 0) * 100),
      expense_account_id: v.expense_account_id ?? null,
    };
    setSaving(true);
    const res = editing ? await updateItemAction(editing.id, payload) : await createItemAction(payload);
    setSaving(false);
    if (res.ok) {
      message.success(editing ? "Item updated" : "Item created");
      setOpen(false);
    } else {
      message.error(res.error ?? "Failed to save item");
    }
  }

  async function toggleActive(it: ItemRow) {
    const res = await setItemActiveAction(it.id, !it.is_active);
    if (res.ok) message.success(it.is_active ? "Item deactivated" : "Item activated");
    else message.error(res.error ?? "Failed to update item");
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New item
          </Button>
        )}
      </Space>
      <Table<ItemRow>
        rowKey="id"
        dataSource={items}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Code", dataIndex: "item_code", render: (v) => v ?? "—" },
          { title: "Name", dataIndex: "name" },
          {
            title: "Sales price",
            dataIndex: "sales_price_minor",
            align: "right",
            render: (v: number, r) => (r.is_sold ? `$${(v / 100).toFixed(2)}` : "—"),
          },
          {
            title: "Cost",
            dataIndex: "purchase_cost_minor",
            align: "right",
            render: (v: number, r) => (r.is_purchased ? `$${(v / 100).toFixed(2)}` : "—"),
          },
          {
            title: "Used for",
            key: "used",
            render: (_, r) => (
              <Space>
                {r.is_sold && <Tag color="blue">Sales</Tag>}
                {r.is_purchased && <Tag color="gold">Purchase</Tag>}
              </Space>
            ),
          },
          {
            title: "Status",
            dataIndex: "is_active",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite ? (
                <Space>
                  <Button size="small" type="link" onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Button size="small" type="link" onClick={() => toggleActive(r)}>
                    {r.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title={editing ? "Edit item" : "New item"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText={editing ? "Save" : "Create"}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="item_code" label="Code (optional)">
              <Input style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Divider titlePlacement="left">
            <Space>
              <Form.Item name="is_sold" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              I sell this
            </Space>
          </Divider>
          {isSold && (
            <Space size="middle" style={{ display: "flex" }} align="start">
              <Form.Item name="sales_price" label="Sales price">
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="income_account_id" label="Income account" style={{ flex: 1, minWidth: 200 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                />
              </Form.Item>
              <Form.Item name="sales_tax_code_id" label="Sales tax">
                <Select
                  allowClear
                  style={{ width: 140 }}
                  options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate_percent}%)` }))}
                />
              </Form.Item>
            </Space>
          )}

          <Divider titlePlacement="left">
            <Space>
              <Form.Item name="is_purchased" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              I buy this
            </Space>
          </Divider>
          {isPurchased && (
            <Space size="middle" style={{ display: "flex" }} align="start">
              <Form.Item name="purchase_cost" label="Cost">
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="expense_account_id" label="Expense account" style={{ flex: 1, minWidth: 200 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                />
              </Form.Item>
            </Space>
          )}
        </Form>
      </Modal>
    </>
  );
}
