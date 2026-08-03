"use client";
import { useMemo, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import IconActionButton from "@/components/ui/IconActionButton";
import type { AccountRow, CurrencyRow, ItemRow, PurchaseOrderLineRow, PurchaseOrderRow, VendorRow } from "@/lib/db/types";
import { itemToBillLineDefaults } from "@/lib/domain/items";
import { poLineTotalMinor } from "@/lib/domain/purchasing";
import { withVendor } from "@/lib/domain/vendors";
import NewVendorButton from "@/components/NewVendorButton";
import { savePurchaseOrderAction } from "./actions";

interface LineForm {
  item_id?: string | null;
  description?: string;
  quantity?: number;
  unit_cost?: number; // decimal, converted to minor on submit
  expense_account_id?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  order?: PurchaseOrderRow;
  lines?: PurchaseOrderLineRow[];
}

/**
 * Create a draft purchase order, or edit one that is still a draft. Line totals
 * shown here come from the shared domain helper; the server recomputes them.
 *
 * The body mounts only while the dialog is open, so the form initializes from
 * the order being edited without an effect.
 */
export default function PurchaseOrderFormModal(props: Props) {
  if (!props.open) return null;
  return <PurchaseOrderFormModalBody {...props} />;
}

function PurchaseOrderFormModalBody({
  onClose,
  onSaved,
  vendors,
  expenseAccounts,
  currencies,
  items,
  order,
  lines,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const currency = order?.currency_code ?? currencies.find((c) => c.is_base)?.code ?? "USD";

  // A vendor created from inside this dialog has to appear in the picker now;
  // the page's own list will not refresh until the order is saved.
  const [localVendors, setLocalVendors] = useState<VendorRow[]>(vendors);
  function addVendor(vendor: VendorRow) {
    setLocalVendors((prev) => withVendor(prev, vendor));
    form.setFieldValue("vendor_id", vendor.id);
  }

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  const initialValues = useMemo(() => {
    const d = currencies.find((c) => c.code === (order?.currency_code ?? currency))?.decimal_places ?? 2;
    if (!order) return { order_date: dayjs(), lines: [{ quantity: 1 }] as LineForm[] };
    return {
      vendor_id: order.vendor_id,
      order_date: dayjs(order.order_date),
      expected_date: order.expected_date ? dayjs(order.expected_date) : undefined,
      ship_to: order.ship_to ?? undefined,
      memo: order.memo ?? undefined,
      lines: (lines ?? []).map((l) => ({
        item_id: l.item_id ?? undefined,
        description: l.description,
        quantity: Number(l.quantity),
        unit_cost: l.unit_cost_minor / 10 ** d,
        expense_account_id: l.expense_account_id,
      })),
    };
    // Computed once at mount; the dialog remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [watchedLines, setWatchedLines] = useState<LineForm[]>(
    () => (initialValues.lines ?? []) as LineForm[],
  );

  const totalMinor = watchedLines.reduce(
    (sum, l) => sum + poLineTotalMinor(l?.quantity ?? 0, Math.round((l?.unit_cost ?? 0) * 10 ** decimals)),
    0,
  );

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await savePurchaseOrderAction(order?.id ?? null, {
      vendor_id: values.vendor_id,
      order_date: values.order_date.format("YYYY-MM-DD"),
      expected_date: values.expected_date ? values.expected_date.format("YYYY-MM-DD") : null,
      currency_code: currency,
      ship_to: values.ship_to ?? null,
      memo: values.memo ?? null,
      lines: (values.lines as LineForm[]).map((l) => ({
        item_id: l.item_id ?? null,
        description: l.description ?? "",
        quantity: l.quantity ?? 0,
        unit_cost_minor: Math.round((l.unit_cost ?? 0) * 10 ** decimals),
        expense_account_id: l.expense_account_id as string,
      })),
    });
    setSaving(false);
    if (res.ok && res.data) {
      message.success(order ? "Purchase order updated" : "Draft purchase order created");
      onSaved(res.data.id);
    } else {
      message.error(res.error ?? "Failed to save purchase order");
    }
  }

  return (
    <Modal
      title={order ? `Edit purchase order ${order.po_number ?? "(draft)"}` : "New purchase order"}
      open
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText={order ? "Save draft" : "Create draft"}
      width={860}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(_, all) => setWatchedLines(all.lines ?? [])}
      >
        <Space align="end" wrap style={{ display: "flex" }}>
          <Form.Item
            name="vendor_id"
            label="Vendor"
            rules={[{ required: true, message: "Select a vendor" }]}
            style={{ minWidth: 320 }}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={localVendors.map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Form.Item label=" ">
            <NewVendorButton onCreated={addVendor} />
          </Form.Item>
        </Space>
        <Space size="middle" wrap style={{ display: "flex" }}>
          <Form.Item name="order_date" label="Order date" rules={[{ required: true, message: "Order date" }]}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="expected_date" label="Expected date">
            <DatePicker />
          </Form.Item>
          <Form.Item label="Currency">
            <Select
              disabled
              value={currency}
              style={{ width: 120 }}
              options={currencies.map((c) => ({ value: c.code, label: c.code }))}
            />
          </Form.Item>
        </Space>
        <Form.Item name="ship_to" label="Ship to">
          <Input placeholder="Delivery address or location" />
        </Form.Item>

        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="baseline" wrap style={{ display: "flex", marginBottom: 8 }}>
                  <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      showSearch
                      placeholder="Item (optional)"
                      style={{ width: 170 }}
                      optionFilterProp="label"
                      options={items.map((i) => ({ value: i.id, label: i.name }))}
                      onChange={(itemId) => {
                        const it = items.find((i) => i.id === itemId);
                        if (!it) return;
                        const d = itemToBillLineDefaults(it);
                        form.setFields([
                          { name: ["lines", field.name, "description"], value: d.description },
                          { name: ["lines", field.name, "expense_account_id"], value: d.expense_account_id ?? undefined },
                          { name: ["lines", field.name, "unit_cost"], value: d.amount_minor / 10 ** decimals },
                        ]);
                        setWatchedLines(form.getFieldValue("lines") ?? []);
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                    <Input placeholder="Description" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "expense_account_id"]}
                    rules={[{ required: true, message: "Account" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      placeholder="Expense account"
                      style={{ width: 200 }}
                      showSearch
                      optionFilterProp="label"
                      options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "quantity"]}
                    rules={[{ required: true, message: "Qty" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0.0001} step={1} placeholder="Qty" style={{ width: 90 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "unit_cost"]}
                    rules={[{ required: true, message: "Unit cost" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0} precision={decimals} placeholder="Unit cost" style={{ width: 130 }} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <IconActionButton
                      label="Remove purchase order line"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        remove(field.name);
                        setWatchedLines(form.getFieldValue("lines") ?? []);
                      }}
                    />
                  )}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />}>
                Add line
              </Button>
            </>
          )}
        </Form.List>

        <Typography.Paragraph strong style={{ marginTop: 16, textAlign: "right" }}>
          Order total: {(totalMinor / 10 ** decimals).toFixed(decimals)} {currency}
        </Typography.Paragraph>
        <Form.Item name="memo" label="Memo">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
