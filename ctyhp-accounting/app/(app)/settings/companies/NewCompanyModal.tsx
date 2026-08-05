"use client";
import { useState, type ChangeEvent } from "react";
import { Alert, App, Form, Input, InputNumber, Modal, Switch, Typography } from "antd";
import { companySlugFromName } from "@/lib/domain/company-slug";
import { requestCompanyAction } from "./actions";

export interface NewCompanyModalProps {
  open: boolean;
  existingSlugs: string[];
  onClose: () => void;
  onQueued: (requestId: string) => void;
}

interface FormValues {
  legal_name: string;
  slug: string;
  is_sample: boolean;
  display_order: number;
}

/**
 * A company is a new set of books, not a record — so the form says what will
 * happen and how long it takes before anyone commits to it.
 */
export default function NewCompanyModal({
  open,
  existingSlugs,
  onClose,
  onQueued,
}: NewCompanyModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  /** The key is a suggestion until the user edits it, then it is theirs. */
  function onNameChange(event: ChangeEvent<HTMLInputElement>) {
    if (form.isFieldTouched("slug")) return;
    form.setFieldsValue({ slug: companySlugFromName(event.target.value) });
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await requestCompanyAction(values);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Could not create the company");
        return;
      }
      message.success("Building the books — this takes about a minute");
      onQueued(res.data.requestId);
      form.resetFields();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New company"
      open={open}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Create company"
      cancelText="Cancel"
      width={560}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="What this does"
        description="A company gets its own set of books — its own chart of accounts, documents and ledger, separate from every other company here. Building it takes about a minute; you can leave this page while it runs."
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ is_sample: false, display_order: 100 }}
      >
        <Form.Item
          name="legal_name"
          label="Legal name"
          rules={[{ required: true, message: "A legal name is required" }, { max: 160 }]}
        >
          <Input placeholder="North Star Bridal LLC" onChange={onNameChange} maxLength={160} />
        </Form.Item>
        <Form.Item
          name="slug"
          label="Company key"
          tooltip="Used in the address bar and as the name of this company's database schema. It cannot be changed later."
          rules={[
            { required: true, message: "A company key is required" },
            {
              pattern: /^[a-z][a-z0-9_]{1,40}$/,
              message: "Lower case letters, digits and underscores, starting with a letter",
            },
            {
              validator: async (_rule, value: string) =>
                existingSlugs.includes(value)
                  ? Promise.reject(new Error("Another company already uses that key"))
                  : Promise.resolve(),
            },
          ]}
        >
          <Input placeholder="north_star" maxLength={41} />
        </Form.Item>
        <Form.Item name="display_order" label="Order in the company list">
          <InputNumber min={0} max={1000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="is_sample" label="Mark as a sample company" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Typography.Text type="secondary">You will be its first administrator.</Typography.Text>
      </Form>
    </Modal>
  );
}
