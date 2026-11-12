"use client";
import { useState } from "react";
import { App, Form, Input, Modal, Typography } from "antd";
import { EDIT_BANK_ACCOUNT } from "@/lib/domain/statement-other-accounts";
import { updateBankAccountAction } from "./actions";

/**
 * Edit account (3.0.22): correct a bank account's name or number.
 *
 * Until now a bank account could be added and never changed, so a name typed
 * for the wrong bank could only be put right by adding the account again — and
 * the same statement was then imported into both. The ledger account and the
 * currency are shown, not offered: lines are already posted to them.
 *
 * The form takes its values from `initialValues` and is destroyed with the
 * dialog, so it always opens on the account chosen; nothing is set on it from
 * outside before it has mounted.
 */
export interface EditableBankAccount {
  id: string;
  bank_name: string;
  account_number_masked: string | null;
  account_code: string;
  account_name: string;
}

interface Props {
  /** The account being edited; null keeps the dialog closed. */
  account: EditableBankAccount | null;
  onClose: () => void;
  /** Called once the change is saved. */
  onSaved: () => void;
}

interface Values {
  bank_name: string;
  account_number_masked?: string | null;
}

export default function EditBankAccountModal({ account, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!account || saving) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await updateBankAccountAction(account.id, values);
      if (!result.ok) {
        // A number another bank account has, or a name left empty: in the server's own words.
        message.error(result.error ?? EDIT_BANK_ACCOUNT.failed, 10);
        return;
      }
      message.success(EDIT_BANK_ACCOUNT.saved);
      onSaved();
    } catch {
      message.error(EDIT_BANK_ACCOUNT.failed, 10);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={EDIT_BANK_ACCOUNT.title}
      open={account !== null}
      onOk={save}
      onCancel={onClose}
      okText="Save"
      cancelText="Cancel"
      confirmLoading={saving}
      destroyOnHidden
    >
      {account ? (
        <Form<Values>
          key={account.id}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ bank_name: account.bank_name, account_number_masked: account.account_number_masked ?? "" }}
        >
          <Form.Item
            name="bank_name"
            label={EDIT_BANK_ACCOUNT.nameLabel}
            rules={[{ required: true, whitespace: true, message: EDIT_BANK_ACCOUNT.nameRequired }]}
          >
            <Input maxLength={120} placeholder="e.g. First National Bank" />
          </Form.Item>
          <Form.Item name="account_number_masked" label={EDIT_BANK_ACCOUNT.numberLabel}>
            <Input maxLength={40} placeholder="e.g. ****1234" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {EDIT_BANK_ACCOUNT.ledgerNote(`${account.account_code} — ${account.account_name}`)}
          </Typography.Paragraph>
        </Form>
      ) : null}
    </Modal>
  );
}
