"use client";
import { useState } from "react";
import Link from "next/link";
import { App, Button, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography } from "antd";
import {
  BarChartOutlined,
  CheckOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  StopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import type { AccountRow, InventoryValuationRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { createItemAction, updateItemAction, setItemActiveAction } from "./actions";
import AdjustInventoryModal from "./AdjustInventoryModal";
import ItemMovementsModal from "./ItemMovementsModal";

interface Props {
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  inventoryAccounts: AccountRow[];
  cogsAccounts: AccountRow[];
  adjustmentAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  /** Quantity and value per inventory item, as of today. */
  onHand: InventoryValuationRow[];
  canWrite: boolean;
}

export default function ItemsClient({
  items,
  incomeAccounts,
  expenseAccounts,
  inventoryAccounts,
  cogsAccounts,
  adjustmentAccounts,
  taxCodes,
  onHand,
  canWrite,
}: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [adjusting, setAdjusting] = useState<ItemRow | null>(null);
  const [viewing, setViewing] = useState<ItemRow | null>(null);
  const [form] = Form.useForm();
  const isSold = Form.useWatch("is_sold", form);
  const isPurchased = Form.useWatch("is_purchased", form);
  const isInventory = Form.useWatch("is_inventory", form);

  const onHandById = new Map(onHand.map((r) => [r.item_id, r]));

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      is_sold: true,
      is_purchased: false,
      is_inventory: false,
      sales_price: 0,
      purchase_cost: 0,
    });
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
      is_inventory: it.is_inventory,
      inventory_account_id: it.inventory_account_id ?? undefined,
      cogs_account_id: it.cogs_account_id ?? undefined,
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
      is_inventory: !!v.is_inventory,
      inventory_account_id: v.inventory_account_id ?? null,
      cogs_account_id: v.cogs_account_id ?? null,
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
      <FilterBar
        resultCount={items.length}
        actions={
          <Space size={8} wrap>
            <Link href="/reports/inventory-valuation" className="accounting-context-link">
              <BarChartOutlined aria-hidden="true" />
              <span>Inventory valuation</span>
            </Link>
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New item
              </Button>
            ) : null}
          </Space>
        }
      />
      <DataTable<ItemRow>
        rowKey="id"
        dataSource={items}
        emptyTitle="No products or services yet"
        emptyDescription="Add jewelry, services, or purchasing items to reuse them on transactions."
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
            title: "On hand",
            key: "on_hand",
            align: "right",
            render: (_, r) => (r.is_inventory ? Number(onHandById.get(r.id)?.qty_on_hand ?? 0) : "—"),
          },
          {
            title: "Inventory value",
            key: "inventory_value",
            align: "right",
            render: (_, r) =>
              r.is_inventory ? `$${((onHandById.get(r.id)?.value_minor ?? 0) / 100).toFixed(2)}` : "—",
          },
          {
            title: "Used for",
            key: "used",
            render: (_, r) => (
              <Space>
                {r.is_sold && <Tag color="blue">Sales</Tag>}
                {r.is_purchased && <Tag color="gold">Purchase</Tag>}
                {r.is_inventory && <Tag color="purple">Inventory</Tag>}
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
            width: 160,
            render: (_, r) =>
              canWrite ? (
                <Space size={4}>
                  <IconActionButton
                    label="Edit item"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(r)}
                  />
                  <IconActionButton
                    label={r.is_active ? "Deactivate item" : "Activate item"}
                    icon={r.is_active ? <StopOutlined /> : <CheckOutlined />}
                    onClick={() => toggleActive(r)}
                  />
                  {r.is_inventory && (
                    <>
                      <IconActionButton
                        label="Adjust inventory"
                        icon={<ToolOutlined />}
                        onClick={() => setAdjusting(r)}
                      />
                      <IconActionButton
                        label="View inventory movements"
                        icon={<HistoryOutlined />}
                        onClick={() => setViewing(r)}
                      />
                    </>
                  )}
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

          <Divider titlePlacement="left">
            <Space>
              <Form.Item name="is_inventory" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              I track quantity on hand
            </Space>
          </Divider>
          {isInventory && (
            <>
              <Space size="middle" style={{ display: "flex" }} align="start">
                <Form.Item name="inventory_account_id" label="Inventory asset account" style={{ flex: 1, minWidth: 220 }}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={inventoryAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                  />
                </Form.Item>
                <Form.Item name="cogs_account_id" label="Cost of Goods Sold account" style={{ flex: 1, minWidth: 220 }}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={cogsAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                  />
                </Form.Item>
              </Space>
              <Typography.Paragraph type="secondary">
                Tracked items are costed at weighted average. Receiving on a purchase order debits the
                asset account; selling relieves it into Cost of Goods Sold. A tracked item must be both
                sold and bought, is purchased through a purchase order rather than a direct bill, and
                appears only on base-currency documents.
              </Typography.Paragraph>
            </>
          )}
        </Form>
      </Modal>

      <AdjustInventoryModal
        open={!!adjusting}
        item={adjusting}
        offsetAccounts={adjustmentAccounts}
        onHandQty={adjusting ? Number(onHandById.get(adjusting.id)?.qty_on_hand ?? 0) : 0}
        onClose={() => setAdjusting(null)}
      />
      <ItemMovementsModal open={!!viewing} item={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
