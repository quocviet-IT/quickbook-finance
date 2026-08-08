"use client";
import { useState } from "react";
import { Alert, App, Form, Input, Modal, Select, Space } from "antd";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL } from "@/lib/domain/accounts";
import { createAccountAction } from "@/app/(app)/accounts/actions";

export interface CreateAccountFromImportProps {
  /** The name in the file, which becomes the proposed account name. */
  ref: string | null;
  onClose: () => void;
  onCreated: (account: { id: string; account_code: string; name: string }) => void;
}

/**
 * Creating the one account a file names and the chart does not have.
 *
 * The review asked for missing accounts to be created automatically during the
 * import. They are not, and this is why: a transaction row is not evidence that
 * an account should exist. One file named "Transfer from PERFBUS CHK (530)",
 * which reads like an account and is actually a description of a transfer —
 * created automatically it would have become a permanent account of a guessed
 * type, in books nobody would think to check.
 *
 * So the convenience is here without the guess. The name is carried over, the
 * code and the type are chosen by the person who knows what the money is, and
 * it happens one account at a time on purpose.
 */
export default function CreateAccountFromImport({
  ref: nameFromFile,
  onClose,
  onCreated,
}: CreateAccountFromImportProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setBusy(true);
    const result = await createAccountAction({
      account_code: String(values.account_code).trim(),
      name: String(values.name).trim(),
      account_type: values.account_type,
      currency_code: "USD",
      is_posting_account: true,
      status: "active",
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not create the account");
      return;
    }
    message.success(`Created ${result.data.account_code} — ${result.data.name}`);
    onCreated(result.data);
    form.resetFields();
  };

  return (
    <Modal
      open={nameFromFile !== null}
      title="Create this account"
      okText="Create"
      okButtonProps={{ loading: busy }}
      onOk={submit}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="Check this is really an account"
          description="A file names accounts and describes transactions in the same column. Nothing here is guessed: the type you choose decides which report the money appears in, and it cannot be inferred from a row."
        />
        <Form form={form} layout="vertical" initialValues={{ name: nameFromFile ?? "" }}>
          <Form.Item
            name="account_code"
            label="Account code"
            rules={[{ required: true, message: "Give the account a code" }]}
          >
            <Input placeholder="e.g. 152" />
          </Form.Item>
          <Form.Item
            name="name"
            label="Account name"
            rules={[{ required: true, message: "Give the account a name" }]}
            extra="Taken from the file. It has to match the file exactly for the rows to find it."
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="account_type"
            label="Type"
            rules={[{ required: true, message: "Choose what kind of account this is" }]}
          >
            <Select
              placeholder="Asset, liability, income, expense…"
              options={ACCOUNT_TYPES.map((type) => ({
                value: type,
                label: ACCOUNT_TYPE_LABEL[type],
              }))}
            />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
