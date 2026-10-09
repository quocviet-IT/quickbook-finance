"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Select } from "antd";
import dayjs from "dayjs";
import { recordTaxPaymentAction } from "@/app/(app)/sales-tax/actions";
import { toMinorUnits } from "@/lib/format";

export interface TaxPaymentAccountOption {
  id: string;
  account_code: string;
  name: string;
}

/** What the dialog opens with: the Sales Tax Center opens it empty, a report may hand it an amount and a range. */
export interface TaxPaymentPrefill {
  amountMinor: number;
  from: string;
  to: string;
}

/**
 * The Record tax payment dialog, shared by the Sales Tax Center and the Sales
 * Tax Liability report. Posts through `recordTaxPaymentAction`
 * (`acc_record_tax_payment`); `onRecorded` runs after a payment is saved, so
 * the screen behind it can read its figures again.
 */
export default function RecordTaxPaymentModal({
  open,
  onClose,
  onRecorded,
  taxPayableAccounts,
  bankAccounts,
  baseCurrency,
  decimals,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
  taxPayableAccounts: readonly TaxPaymentAccountOption[];
  bankAccounts: readonly TaxPaymentAccountOption[];
  baseCurrency: string;
  decimals: number;
  prefill?: TaxPaymentPrefill;
}) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await recordTaxPaymentAction({
      tax_account_id: v.tax_account_id,
      bank_account_id: v.bank_account_id,
      currency_code: baseCurrency,
      amount_minor: toMinorUnits(Number(v.amount ?? 0), decimals),
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      period_start: v.period ? v.period[0].format("YYYY-MM-DD") : null,
      period_end: v.period ? v.period[1].format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Tax payment recorded");
      onClose();
      form.resetFields();
      onRecorded();
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  // Applied when the form mounts, which is each time the dialog opens: the
  // prefill is what the screen showed at that moment.
  const initialValues = prefill
    ? {
        amount: prefill.amountMinor / 10 ** decimals,
        period: [dayjs(prefill.from), dayjs(prefill.to)],
        tax_account_id: taxPayableAccounts.length === 1 ? taxPayableAccounts[0].id : undefined,
      }
    : undefined;

  return (
    <Modal
      title="Record tax payment"
      open={open}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Record"
      destroyOnHidden={prefill !== undefined}
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="tax_account_id" label="Sales Tax Payable account" rules={[{ required: true, message: "Select the tax account" }]}>
          <Select showSearch optionFilterProp="label" options={taxPayableAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
        </Form.Item>
        <Form.Item name="bank_account_id" label="Pay from" rules={[{ required: true, message: "Select a bank account" }]}>
          <Select showSearch optionFilterProp="label" options={bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
        </Form.Item>
        <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter an amount" }]}>
          <InputNumber min={0} precision={decimals} prefix="$" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="payment_date" label="Payment date"><DatePicker /></Form.Item>
        <Form.Item name="period" label="Period covered"><DatePicker.RangePicker /></Form.Item>
        <Form.Item name="memo" label="Memo"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
