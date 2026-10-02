"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, Modal, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { seedRelatedWords } from "@/lib/domain/related-companies";
import { formatMoney } from "@/lib/format";
import type { RelatedPreview } from "@/lib/services/related-companies";
import { previewRelatedCompanyAction, saveRelatedCompanyAction } from "./actions";
import styles from "./repayments.module.css";

export interface RelatedFormValues {
  name: string;
  matchWords: string;
  accountId: string | null;
  isActive: boolean;
}

export const EMPTY_RELATED: RelatedFormValues = { name: "", matchWords: "", accountId: null, isActive: true };

export function toRelatedInput(values: RelatedFormValues) {
  return {
    name: (values.name ?? "").trim(),
    matchWords: (values.matchWords ?? "").trim(),
    accountId: values.accountId ?? "",
    isActive: values.isActive,
  };
}

/**
 * Add or change a related company. Typing the name fills in the words its bank
 * is likely to print, until the person types their own; the preview then lists
 * the lines waiting now that those words name, so a short word that catches
 * too much is seen before anything is saved.
 */
export default function RelatedCompanyFormModal({
  open,
  relatedId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  relatedId: string | null;
  initial: RelatedFormValues;
  /** Current asset and liability accounts no other related company or card or loan uses, plus this one's own. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RelatedFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RelatedPreview | null>(null);
  const watchedWords = Form.useWatch("matchWords", form) as string | undefined;
  const words = (watchedWords ?? initial.matchWords).trim();

  useEffect(() => {
    if (!open || !words) return;
    const timer = setTimeout(() => {
      void previewRelatedCompanyAction({ matchWords: words }).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, words]);

  const options = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [accounts],
  );

  function close() {
    setPreview(null);
    onClose();
  }

  // A new company takes its words from its name, until the person types their own.
  function onValuesChange(changed: Partial<RelatedFormValues>) {
    if (relatedId || !("name" in changed)) return;
    if (!form.isFieldTouched("matchWords")) form.setFieldValue("matchWords", seedRelatedWords(changed.name ?? ""));
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveRelatedCompanyAction(relatedId, toRelatedInput({ ...EMPTY_RELATED, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the related company");
      return;
    }
    message.success(`Related company ${relatedId ? "saved" : "added"}`);
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={`${relatedId ? "Edit" : "Add"} related company`}
      okText={relatedId ? "Save" : "Add related company"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item
          name="name"
          label="Company name"
          rules={[
            { required: true, whitespace: true, message: "Give the company's name" },
            { max: 120, message: "The name is at most 120 characters" },
          ]}
        >
          <Input placeholder="Example Affiliate, LLC" />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for this company"
          extra="Separate several with commas. Each is matched as whole words, in any case — a short one such as EXA does not match EXAMPLE."
          rules={[
            { required: true, whitespace: true, message: "Give the words your bank prints for this company" },
            { max: 200, message: "Words are at most 200 characters" },
          ]}
        >
          <Input placeholder="example affiliate, exa" />
        </Form.Item>
        <Form.Item
          name="accountId"
          label="Account it owes or is owed on"
          extra={
            relatedId
              ? "The account is fixed once the company is saved. To use another account, remove this company and add it again."
              : "Money out to this company debits it and money in credits it, so its balance says who owes whom. A current asset or a liability — never income or an expense."
          }
          rules={[{ required: true, message: "Choose the account it owes or is owed on" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Choose a current asset or liability account"
            options={options}
            disabled={relatedId !== null}
          />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview && words ? (
        <div className={styles.preview}>
          <Typography.Text strong>
            Names {preview.waiting} waiting line{s(preview.waiting)}
          </Typography.Text>
          {preview.lines.map((line, i) => (
            <Typography.Text key={`${line.date}-${i}`} type="secondary" className={styles.missed}>
              {line.date} · {line.description} · {formatMoney(line.amountMinor, USD_CURRENCY_CODE, 2)}
            </Typography.Text>
          ))}
          {preview.waiting > preview.lines.length ? (
            <Typography.Text type="secondary" className={styles.missed}>
              and {preview.waiting - preview.lines.length} more
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
