"use client";
import { useState } from "react";
import { App, Button, Divider, Select, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { BankCategoryRow } from "@/lib/db/types";
import { createBankCategoryAction, setBankTransactionCategoryAction } from "./actions";

export interface BankCategoryCellProps {
  transactionId: string;
  /** The label currently on this line, from `bank_category_id`. */
  value: string | null;
  valueName: string | null;
  categories: BankCategoryRow[];
  canWrite: boolean;
  onCreated: (category: BankCategoryRow) => void;
  onAssigned: (transactionId: string, categoryId: string | null) => void;
}

/**
 * One bank line's label.
 *
 * Chosen straight in the row and saved at once — a label is not a document, so
 * there is nothing to submit. A name nobody has used yet can be created here
 * rather than on a settings screen, because the moment you need a new word for
 * a transaction is while you are looking at the transaction.
 *
 * This control never reads or writes the feed's own `category`; that is what the
 * bank said, and it belongs under the description.
 */
export default function BankCategoryCell({
  transactionId,
  value,
  valueName,
  categories,
  canWrite,
  onCreated,
  onAssigned,
}: BankCategoryCellProps) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [typed, setTyped] = useState("");

  // A reader sees the fact, not a control they cannot use.
  if (!canWrite) {
    return valueName ? (
      <span>{valueName}</span>
    ) : (
      <Typography.Text type="secondary">—</Typography.Text>
    );
  }

  async function assign(categoryId: string | null) {
    setSaving(true);
    try {
      const res = await setBankTransactionCategoryAction(transactionId, categoryId);
      if (!res.ok) {
        message.error(res.error ?? "Could not save the category");
        return;
      }
      onAssigned(transactionId, categoryId);
    } finally {
      setSaving(false);
    }
  }

  async function createAndAssign() {
    const name = typed.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await createBankCategoryAction(name);
      if (!created.ok || !created.data) {
        message.error(created.error ?? "Could not create the category");
        return;
      }
      onCreated({ id: created.data.id, name: created.data.name, is_active: true });
      const res = await setBankTransactionCategoryAction(transactionId, created.data.id);
      if (!res.ok) {
        message.error(res.error ?? "Could not save the category");
        return;
      }
      onAssigned(transactionId, created.data.id);
      setTyped("");
    } finally {
      setSaving(false);
    }
  }

  const knownName = categories.some(
    (category) => category.name.toLowerCase() === typed.trim().toLowerCase(),
  );

  return (
    <Select
      value={value ?? undefined}
      loading={saving}
      disabled={saving}
      allowClear
      showSearch
      placeholder="Uncategorized"
      style={{ minWidth: 170 }}
      aria-label="Category"
      optionFilterProp="label"
      onSearch={setTyped}
      onChange={(next) => void assign(next ?? null)}
      options={categories.map((category) => ({ value: category.id, label: category.name }))}
      notFoundContent={null}
      popupRender={(menu) => (
        <>
          {menu}
          {typed.trim() && !knownName ? (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => void createAndAssign()}
              >
                Create “{typed.trim()}”
              </Button>
            </>
          ) : null}
        </>
      )}
    />
  );
}
