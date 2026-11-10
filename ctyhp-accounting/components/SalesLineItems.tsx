"use client";
import { Button, Form, Input, InputNumber, Select, Typography } from "antd";
import type { SelectProps } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import IconActionButton from "@/components/ui/IconActionButton";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import type { AccountRow, ItemRow } from "@/lib/db/types";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";
import { salesLineAmountMinor, type SalesLineValues } from "@/lib/domain/sales-form";
import { formatMoney } from "@/lib/format";
import styles from "./sales-line-items.module.css";

/**
 * The width of a dialog that holds this editor: its seven columns at widths a
 * value fits in, with Description taking what is left (3.0.10). The editor
 * scrolls sideways inside a narrower window rather than wrapping a line in two.
 */
export const SALES_DOCUMENT_MODAL_WIDTH = 1100;

/** Fixed column widths, in order; Description has none and takes what is left. */
const COLUMNS = { item: 150, qty: 80, price: 120, amount: 110, account: 190, tax: 150, remove: 40 } as const;

/** The `*` after a required column's heading; the field itself says aria-required. */
function Required() {
  return (
    <span className={styles.required} aria-hidden="true">
      {" *"}
    </span>
  );
}

/**
 * The line items of a sales document: item, description, quantity, unit
 * price, amount, income account and tax code, one row each.
 *
 * Written for the New invoice form and shared with the estimate form, because
 * an estimate is turned into an invoice and the promise is that nothing is
 * lost on the way. Two editors would drift: a picker that filled the price on
 * one and not the other would make the same customer two different totals.
 *
 * A table since 3.0.10: each column has a heading and each field a label
 * naming its line and column. The fields used to carry their name only as a
 * placeholder, so a filled-in "1" said nothing about what it was, and each line
 * broke over two rows.
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
  currencyCode = "USD",
  canManageItems,
  removeLabel,
  defaultIncomeAccountId = null,
}: {
  /** Sold, active catalog entries. */
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  /** Sales tax codes, grouped by state. */
  taxOptions: SelectProps["options"];
  /** The document currency's decimal places, for the price an item fills in. */
  decimals: number;
  /** The document currency, for each line's amount. */
  currencyCode?: string;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
  /** Read out for the remove button on each line, followed by its number. */
  removeLabel: string;
  /** The company's default income account (3.01), for a line added without an item. */
  defaultIncomeAccountId?: string | null;
}) {
  const form = Form.useFormInstance();
  const watched = (Form.useWatch("lines", form) ?? []) as (SalesLineValues | undefined)[];
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
            <div className={styles.scroll}>
              <table className={styles.table}>
                <colgroup>
                  <col style={{ width: COLUMNS.item }} />
                  <col />
                  <col style={{ width: COLUMNS.qty }} />
                  <col style={{ width: COLUMNS.price }} />
                  <col style={{ width: COLUMNS.amount }} />
                  <col style={{ width: COLUMNS.account }} />
                  <col style={{ width: COLUMNS.tax }} />
                  <col style={{ width: COLUMNS.remove }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Description</th>
                    <th scope="col" className={styles.number}>
                      Qty
                      <Required />
                    </th>
                    <th scope="col" className={styles.number}>
                      Unit price
                      <Required />
                    </th>
                    <th scope="col" className={styles.number}>
                      Amount
                    </th>
                    <th scope="col">
                      Income account
                      <Required />
                    </th>
                    <th scope="col">Tax</th>
                    <th scope="col">
                      <span className="accounting-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => {
                    const amountMinor = salesLineAmountMinor(watched[field.name], decimals);
                    return (
                      <tr key={field.key}>
                        <td>
                          <Form.Item name={[field.name, "item_id"]} className={styles.cell}>
                            <Select
                              aria-label={`Line ${index + 1} item`}
                              allowClear
                              showSearch
                              placeholder="Optional"
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
                        </td>
                        <td>
                          <Form.Item name={[field.name, "description"]} className={styles.cell}>
                            <Input aria-label={`Line ${index + 1} description`} />
                          </Form.Item>
                        </td>
                        <td>
                          <Form.Item
                            name={[field.name, "quantity"]}
                            className={styles.cell}
                            rules={[{ required: true, message: "Enter a quantity" }]}
                          >
                            <InputNumber aria-label={`Line ${index + 1} quantity`} min={0} className={styles.numberInput} />
                          </Form.Item>
                        </td>
                        <td>
                          <Form.Item
                            name={[field.name, "unit_price"]}
                            className={styles.cell}
                            rules={[{ required: true, message: "Enter a unit price" }]}
                          >
                            <InputNumber
                              aria-label={`Line ${index + 1} unit price`}
                              min={0}
                              step={0.01}
                              prefix="$"
                              className={styles.numberInput}
                            />
                          </Form.Item>
                        </td>
                        <td className={styles.amount}>
                          {amountMinor === null ? "—" : formatMoney(amountMinor, currencyCode, decimals)}
                        </td>
                        <td>
                          <Form.Item
                            name={[field.name, "income_account_id"]}
                            className={styles.cell}
                            rules={[{ required: true, message: "Choose an income account" }]}
                          >
                            <Select
                              aria-label={`Line ${index + 1} income account`}
                              options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                            />
                          </Form.Item>
                        </td>
                        <td>
                          <Form.Item name={[field.name, "tax_code_id"]} className={styles.cell}>
                            <Select
                              aria-label={`Line ${index + 1} tax`}
                              allowClear
                              showSearch
                              placeholder="No tax"
                              optionFilterProp="label"
                              options={taxOptions}
                            />
                          </Form.Item>
                        </td>
                        <td>
                          <IconActionButton
                            label={`${removeLabel} ${index + 1}`}
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button
              type="dashed"
              onClick={() => add({ quantity: 1, income_account_id: defaultIncomeAccountId ?? undefined })}
              icon={<PlusOutlined />}
              block
              className={styles.add}
            >
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
