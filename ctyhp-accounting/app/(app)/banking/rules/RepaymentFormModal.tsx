"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, InputNumber, Modal, Radio, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { seedDigits, seedWords, type InterestMethod, type RepaymentKind } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import { previewRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentFormValues {
  accountId: string | null;
  matchWords: string;
  matchDigits: string;
  isActive: boolean;
  /** Loans only. */
  interestAccountId: string | null;
  interestMethod: InterestMethod;
  /** Percent a year. */
  annualRate: number | null;
  /** Dollars per payment. */
  fixedInterest: number | null;
}

export const EMPTY_REPAYMENT: RepaymentFormValues = {
  accountId: null,
  matchWords: "",
  matchDigits: "",
  isActive: true,
  interestAccountId: null,
  interestMethod: "rate",
  annualRate: null,
  fixedInterest: null,
};

export function toRepaymentInput(kind: RepaymentKind, values: RepaymentFormValues) {
  const digits = (values.matchDigits ?? "").trim();
  const common = {
    accountId: values.accountId ?? "",
    matchWords: (values.matchWords ?? "").trim(),
    matchDigits: digits === "" ? null : digits,
    isActive: values.isActive,
  };
  if (kind === "card") return { kind: "card" as const, ...common };
  return {
    kind: "loan" as const,
    ...common,
    interestAccountId: values.interestAccountId ?? "",
    interestMethod: values.interestMethod,
    annualRate: values.interestMethod === "rate" ? values.annualRate : null,
    fixedInterestMinor:
      values.interestMethod === "fixed" && values.fixedInterest !== null && values.fixedInterest !== undefined
        ? Math.round(values.fixedInterest * 100)
        : null,
  };
}

/**
 * Add or change a card or a loan. Choosing the account fills in the words and
 * last four from its name; the preview then says how many past payments to
 * that account those words catch, and which they miss, before anything is
 * saved. A loan also says where its interest goes and how it is worked out.
 */
export default function RepaymentFormModal({
  open,
  kind,
  repaymentId,
  initial,
  accounts,
  interestAccounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: RepaymentKind;
  repaymentId: string | null;
  initial: RepaymentFormValues;
  /** Accounts this kind may repay, not yet registered, plus this entry's own. */
  accounts: AccountRow[];
  /** Active posting expense and other-expense accounts. */
  interestAccounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RepaymentFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RepaymentStats | null>(null);
  const watched = Form.useWatch([], form) as RepaymentFormValues | undefined;
  const method = watched?.interestMethod ?? initial.interestMethod;
  const noun = kind === "card" ? "card" : "loan";

  const previewKey = useMemo(() => {
    if (!watched?.accountId) return "";
    const { accountId, matchWords, matchDigits } = toRepaymentInput("card", { ...EMPTY_REPAYMENT, ...watched });
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
  const interestOptions = useMemo(
    () => interestAccounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [interestAccounts],
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
    const res = await saveRepaymentAction(repaymentId, toRepaymentInput(kind, { ...EMPTY_REPAYMENT, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? `Could not save the ${noun}`);
      return;
    }
    message.success(`${kind === "card" ? "Card" : "Loan"} ${repaymentId ? "saved" : "added"}`);
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={`${repaymentId ? "Edit" : "Add"} ${noun}`}
      okText={`${repaymentId ? "Save" : "Add"} ${noun}`}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item
          name="accountId"
          label={kind === "card" ? "Card account" : "Loan account"}
          rules={[{ required: true, message: `Choose the ${noun} account` }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={kind === "card" ? "Choose a Credit Card account" : "Choose a liability account"}
            options={options}
            disabled={repaymentId !== null}
          />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for these payments"
          extra="Separate several with commas. Each is matched as whole words, in any case."
          rules={[{ max: 200, message: "Words are at most 200 characters" }]}
        >
          <Input placeholder={kind === "card" ? "example card, example card epay" : "example loan, loan pmt"} />
        </Form.Item>
        <Form.Item
          name="matchDigits"
          label="Last four digits (optional)"
          rules={[{ pattern: /^\d{4}$/, message: "The last four are exactly four digits" }]}
        >
          <Input maxLength={4} inputMode="numeric" style={{ width: 120 }} />
        </Form.Item>
        {kind === "loan" ? (
          <>
            <Form.Item name="interestAccountId" label="Interest posts to" rules={[{ required: true, message: "Choose the account interest posts to" }]}>
              <Select showSearch optionFilterProp="label" placeholder="Choose an expense account" options={interestOptions} />
            </Form.Item>
            <Form.Item name="interestMethod" label="Interest on each payment">
              <Radio.Group
                optionType="button"
                options={[
                  { value: "rate", label: "A rate a year" },
                  { value: "fixed", label: "A fixed amount" },
                  { value: "entered", label: "Typed each time" },
                ]}
              />
            </Form.Item>
            {method === "rate" ? (
              <Form.Item
                name="annualRate"
                label="Rate a year"
                extra="Interest proposed = balance owed on the books × this rate ÷ 12. You can change it on every payment."
                rules={[{ required: true, message: "Give the rate a year" }]}
              >
                <InputNumber min={0} max={100} precision={3} suffix="%" style={{ width: 160 }} />
              </Form.Item>
            ) : null}
            {method === "fixed" ? (
              <Form.Item name="fixedInterest" label="Interest on each payment" rules={[{ required: true, message: "Give the fixed interest per payment" }]}>
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 160 }} />
              </Form.Item>
            ) : null}
            {method === "entered" ? (
              <Typography.Paragraph type="secondary">
                No interest is proposed. Each payment waits until the interest from the lender&apos;s statement is typed in.
              </Typography.Paragraph>
            ) : null}
          </>
        ) : null}
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
