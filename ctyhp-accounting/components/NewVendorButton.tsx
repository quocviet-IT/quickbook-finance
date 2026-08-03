"use client";
import { useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Space } from "antd";
import type { VendorRow } from "@/lib/db/types";
import { parsePaymentTerms } from "@/lib/domain/payment-terms";
import { createdVendorRow, type NewVendorInput } from "@/lib/domain/vendors";
import { createVendorAction } from "@/app/(app)/vendors/actions";

/**
 * Create a vendor without leaving the document being written.
 *
 * Every screen that raises something against a vendor — purchase orders, bills,
 * expenses, vendor credits, recurring templates — used to dead-end when the
 * vendor did not exist yet: leave, go to the vendor list, come back, start
 * again. Sales had the answer already in the invoice form's "+ New customer";
 * this is the same idea, once, for the purchasing side.
 *
 * Payment terms are on the form even though the customer equivalent asks only
 * for a name and an email. They are not decoration: a bill snapshots its
 * vendor's terms when it posts (`acc_apply_vendor_terms`), and they decide the
 * due date and whether an early payment discount can be taken. A vendor created
 * without them quietly gets defaults on its first bill, and nobody comes back.
 */
export default function NewVendorButton({
  onCreated,
}: {
  /** Called with the new vendor so the caller can list and select it at once. */
  onCreated: (vendor: VendorRow) => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<NewVendorInput>();

  /**
   * Terms get written before they are configured. When the text is something
   * the parser recognises — "Net 30", "1/10 net 30" — fill the numbers in, so
   * nobody types the same thing twice and no bill ends up with terms that
   * disagree with their own label. Same behaviour as the Vendors screen.
   */
  function onTermsTyped(event: React.ChangeEvent<HTMLInputElement>) {
    const parsed = parsePaymentTerms(event.target.value);
    if (!parsed) return;
    form.setFieldsValue({
      payment_terms_days: parsed.netDays,
      discount_percent: parsed.discountPercent > 0 ? parsed.discountPercent : null,
      discount_days: parsed.discountPercent > 0 ? parsed.discountDays : null,
    });
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await createVendorAction(values);
    setSaving(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to create vendor");
      return;
    }
    onCreated(createdVendorRow(res.data.id, { ...values, name: res.data.name }));
    message.success("Vendor added");
    setOpen(false);
    form.resetFields();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New vendor</Button>
      <Modal
        title="New vendor"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Add"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item
            name="payment_terms"
            label="Payment terms"
            tooltip="What the vendor calls it. The numbers below are what the system computes with, and a bill posted later keeps whatever they are at that moment."
          >
            <Input placeholder="e.g. Net 30, or 1/10 net 30" onChange={onTermsTyped} />
          </Form.Item>
          <Space size="middle" wrap>
            <Form.Item
              name="payment_terms_days"
              label="Net days"
              tooltip="Days from the bill date until the full amount is due. 0 means due on receipt."
            >
              <InputNumber min={0} max={365} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              name="discount_percent"
              label="Discount %"
              tooltip="Percentage off for paying early. Leave empty when the vendor offers none."
            >
              <InputNumber min={0} max={100} step={0.5} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              name="discount_days"
              label="Discount days"
              tooltip="Days from the bill date within which that discount can still be taken."
            >
              <InputNumber min={0} max={365} style={{ width: 130 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
