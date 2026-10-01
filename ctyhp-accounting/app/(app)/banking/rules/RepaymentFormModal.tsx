"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, Modal, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { seedDigits, seedWords } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import { previewRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentFormValues {
  accountId: string | null;
  matchWords: string;
  matchDigits: string;
  isActive: boolean;
}

export const EMPTY_CARD: RepaymentFormValues = { accountId: null, matchWords: "", matchDigits: "", isActive: true };

export function toRepaymentInput(values: RepaymentFormValues) {
  const digits = (values.matchDigits ?? "").trim();
  return {
    kind: "card" as const,
    accountId: values.accountId ?? "",
    matchWords: (values.matchWords ?? "").trim(),
    matchDigits: digits === "" ? null : digits,
    isActive: values.isActive,
  };
}

/**
 * Add or change a card. Choosing the account fills in the words and last four
 * from its name; the preview then says how many past payments to that account
 * those words catch, and which they miss, before anything is saved.
 */
export default function RepaymentFormModal({
  open,
  repaymentId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  repaymentId: string | null;
  initial: RepaymentFormValues;
  /** Credit card accounts not yet registered, plus this entry's own. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RepaymentFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RepaymentStats | null>(null);
  const watched = Form.useWatch([], form) as RepaymentFormValues | undefined;

  const previewKey = useMemo(() => {
    if (!watched?.accountId) return "";
    const { accountId, matchWords, matchDigits } = toRepaymentInput({ ...EMPTY_CARD, ...watched });
    if (!matchWords && !matchDigits) return "";
    if (matchDigits && !/^\d{4}$/.test(matchDigits)) return "";
    return JSON.stringify({ accountId, matchWords, matchDigits });
  }, [watched]);

  useEffect(() => {
    if (!open || !previewKey) return;
    const timer = setTimeout(() => {
      void previewRepaymentAction(JSON.parse(previewKey)).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, previewKey]);

  const options = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [accounts],
  );

  function close() {
    setPreview(null);
    onClose();
  }

  // A new entry takes its words and digits from the account's name, until the person types their own.
  function onValuesChange(changed: Partial<RepaymentFormValues>) {
    if (repaymentId || !("accountId" in changed)) return;
    const account = accounts.find((a) => a.id === changed.accountId);
    if (!account) return;
    if (!form.isFieldTouched("matchWords")) form.setFieldValue("matchWords", seedWords(account.name));
    if (!form.isFieldTouched("matchDigits")) form.setFieldValue("matchDigits", seedDigits(account.name) ?? "");
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveRepaymentAction(repaymentId, toRepaymentInput({ ...EMPTY_CARD, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the card");
      return;
    }
    message.success(repaymentId ? "Card saved" : "Card added");
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={repaymentId ? "Edit card" : "Add card"}
      okText={repaymentId ? "Save card" : "Add card"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item name="accountId" label="Card account" rules={[{ required: true, message: "Choose the card account" }]}>
          <Select showSearch optionFilterProp="label" placeholder="Choose a Credit Card account" options={options} disabled={repaymentId !== null} />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for these payments"
          extra="Separate several with commas. Each is matched as whole words, in any case."
          rules={[{ max: 200, message: "Words are at most 200 characters" }]}
        >
          <Input placeholder="example card, example card epay" />
        </Form.Item>
        <Form.Item
          name="matchDigits"
          label="Last four digits (optional)"
          rules={[{ pattern: /^\d{4}$/, message: "The last four are exactly four digits" }]}
        >
          <Input maxLength={4} inputMode="numeric" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview ? (
        <div className={styles.preview}>
          <Typography.Text strong>
            {preview.past === 0
              ? "No past payments to this account yet"
              : `Catches ${preview.caught} of ${preview.past} past payment${s(preview.past)} to this account`}
            {` · ${preview.waiting} waiting line${s(preview.waiting)}`}
          </Typography.Text>
          {preview.missed.length ? (
            <>
              <Typography.Text type="secondary" className={styles.missed}>
                Missed — add the words these use:
              </Typography.Text>
              {preview.missed.map((miss, i) => (
                <Typography.Text key={`${miss.date}-${i}`} type="secondary" className={styles.missed}>
                  {miss.date} · {miss.text}
                </Typography.Text>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
