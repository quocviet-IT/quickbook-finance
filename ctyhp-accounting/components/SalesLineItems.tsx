"use client";
import { Button, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import IconActionButton from "@/components/ui/IconActionButton";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import type { AccountRow, ItemRow } from "@/lib/db/types";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";

/**
 * The line items of a sales document: item, description, quantity, unit
 * price, income account and tax code, one row each.
 *
 * Written for the New invoice form and shared with the estimate form, because
 * an estimate is turned into an invoice and the promise is that nothing is
 * lost on the way. Two editors would drift: a picker that filled the price on
 * one and not the other would make the same customer two different totals.
 *
 * Renders inside the caller's `<Form>`, whose `lines` list it owns. Picking an
 * item fills that line's description, price, income account and tax code from
 * the catalog (`itemToInvoiceLineDefaults`); every field stays editable.
 */
export default function SalesLineItems({
  items,
  incomeAccounts,
  taxOptions,
  decimals,
  canManageItems,
  removeLabel,
}: {
  /** Sold, active catalog entries. */
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  /** Sales tax codes, grouped by state. */
  taxOptions: SelectProps["options"];
  /** The document currency's decimal places, for the price an item fills in. */
  decimals: number;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
  /** Read out for the remove button on each line. */
  removeLabel: string;
}) {
  const form = Form.useFormInstance();
  return (
    <>
      {/* A block of its own: the header row above is an inline Space, and when
          it is short (a sales user has no New customer button) an inline
          heading rose beside it and broke over two lines. */}
      <Typography.Text strong style={{ display: "block" }}>
        Line items
      </Typography.Text>
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
                    notFoundContent={items.length === 0 ? "No products or services yet" : undefined}
                    options={items.map((i) => ({ value: i.id, label: i.name }))}
                    onChange={(itemId) => {
                      const it = items.find((i) => i.id === itemId);
                      if (!it) return;
                      const d = itemToInvoiceLineDefaults(it);
                      form.setFields([
                        { name: ["lines", field.name, "description"], value: d.description },
                        { name: ["lines", field.name, "unit_price"], value: d.unit_price_minor / 10 ** decimals },
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
                  label={removeLabel}
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

      {items.length === 0 ? (
        <div style={{ marginTop: 8 }}>
          <EmptyCatalogHint canManage={canManageItems}>
            No products or services yet, so every line must be typed in full. Save the price once in
          </EmptyCatalogHint>
        </div>
      ) : null}
    </>
  );
}
