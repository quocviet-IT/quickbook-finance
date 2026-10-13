"use client";
import { useState } from "react";
import { App, Button, Form, Input, Modal } from "antd";
import { createCustomerAction } from "@/app/(app)/invoices/actions";

/**
 * Create a customer without leaving the document being written.
 *
 * The same two fields as the New invoice form's "+ New customer": a name and
 * an email. Terms, address and credit limit are set on the Customers screen;
 * a document needs only someone to address. Calls the invoices' own action,
 * so a customer added here is the same record either way.
 */
export default function NewCustomerButton({
  onCreated,
  disabled,
}: {
  /** Called with the new customer so the caller can list and select it at once. */
  onCreated: (customer: { id: string; name: string }) => void;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ name: string; email?: string }>();

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await createCustomerAction(values);
    setSaving(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to add customer");
      return;
    }
    onCreated(res.data);
    message.success("Customer added");
    setOpen(false);
    form.resetFields();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        + New customer
      </Button>
      <Modal
        title="New customer"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Add"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
