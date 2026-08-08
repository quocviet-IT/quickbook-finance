"use client";
import { useState } from "react";
import { Alert, App, Form, Input, Modal, Select, Space, Typography } from "antd";
import {
  BANK_SETUP_DETAIL_TYPES,
  bankDetailLabel,
  type BankDetailType,
} from "@/lib/domain/bank-account-detail";
import { createBankAccountAction } from "@/app/(app)/banking/actions";
import type { UnbankedRef } from "@/lib/services/import-preflight";

export interface AddBankRecordFromImportProps {
  target: UnbankedRef | null;
  onClose: () => void;
  onAdded: () => void;
}

/**
 * Declaring a bank account without leaving the import screen.
 *
 * "The system instructs users to add these under Banking first, but this
 * dependency is only revealed at the end of the import process." Eight bank
 * accounts meant eight trips to another screen and back, each one losing the
 * file that had already been read.
 *
 * The kind of account is still asked for rather than assumed. It decides what
 * the balance sheet calls the money, and the database refuses a cash-on-hand
 * ledger outright — physical cash has no statement to import.
 */
export default function AddBankRecordFromImport({
  target,
  onClose,
  onAdded,
}: AddBankRecordFromImportProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    const values = await form.validateFields();
    setBusy(true);
    const result = await createBankAccountAction({
      account_id: target.accountId,
      bank_name: String(values.bank_name).trim(),
      account_number_masked: values.account_number_masked
        ? String(values.account_number_masked).trim()
        : null,
      currency_code: "USD",
      detail_type: values.detail_type,
    });
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not add this bank account");
      return;
    }
    message.success(`${target.accountCode} — ${target.accountName} is now under Banking`);
    form.resetFields();
    onAdded();
  };

  return (
    <Modal
      open={target !== null}
      title="Add this bank account"
      okText="Add"
      okButtonProps={{ loading: busy }}
      onOk={submit}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Typography.Text>
          <b>
            {target?.accountCode} — {target?.accountName}
          </b>{" "}
          · {target?.rows} row(s) in this file
        </Typography.Text>
        <Alert
          type="info"
          showIcon
          message="Why this is needed"
          description="Each row also writes a bank line, and the unique hash on that line is the only thing that stops a second import of the same file posting the same money twice."
        />
        <Form form={form} layout="vertical" initialValues={{ detail_type: "checking" }}>
          <Form.Item
            name="detail_type"
            label="What kind of account is this?"
            rules={[{ required: true, message: "Choose the kind of account" }]}
            extra="Cash on hand is not offered: physical cash has no bank statement to import."
          >
            <Select
              options={BANK_SETUP_DETAIL_TYPES.map((detail: BankDetailType) => ({
                value: detail,
                label: bankDetailLabel(detail),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="bank_name"
            label="Bank name"
            rules={[{ required: true, message: "Enter the bank name" }]}
          >
            <Input placeholder="e.g. First National Bank" />
          </Form.Item>
          <Form.Item name="account_number_masked" label="Account number (masked)">
            <Input placeholder="e.g. ****1234" />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
