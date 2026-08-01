"use client";
import { useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import type { AccountRow, Box1099Row, VendorRow } from "@/lib/db/types";
import { parsePaymentTerms } from "@/lib/domain/payment-terms";
import { createVendorAction } from "./actions";
import VendorTaxDrawer from "./VendorTaxDrawer";

export default function VendorsClient({
  vendors,
  apAccounts,
  expenseAccounts,
  boxes,
  canWrite,
  canManageTax,
}: {
  vendors: VendorRow[];
  apAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  boxes: Box1099Row[];
  canWrite: boolean;
  /** The elevated vendor.tax_manage permission. */
  canManageTax: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [taxFor, setTaxFor] = useState<VendorRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await createVendorAction(values);
    setSaving(false);
    if (res.ok) {
      message.success("Vendor created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create vendor");
    }
  }

  /**
   * Terms are written before they are configured. When the text is something
   * the parser recognises — "Net 30", "1/10 net 30" — fill the numbers in, so
   * nobody types the same thing twice and no bill ends up with terms that
   * disagree with their own label.
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

  return (
    <>
      <FilterBar
        resultCount={vendors.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              New vendor
            </Button>
          ) : null
        }
      />
      <DataTable<VendorRow>
        rowKey="id"
        dataSource={vendors}
        emptyTitle="No vendors yet"
        emptyDescription="Add a vendor to record bills, expenses, and payments."
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Email", dataIndex: "email", render: (v) => v ?? "—" },
          { title: "Phone", dataIndex: "phone", render: (v) => v ?? "—" },
          {
            title: "Terms",
            dataIndex: "payment_terms",
            render: (v: string | null, r) =>
              r.discount_percent
                ? `${v ?? ""} (${r.discount_percent}% within ${r.discount_days ?? 0}d)`.trim()
                : (v ?? "—"),
          },
          {
            title: "Status",
            dataIndex: "is_active",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) => (
              <Space>
                <Button size="small" type="link" onClick={() => setTaxFor(r)}>
                  Tax profile
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="New vendor"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Create"
      >
        <Form form={form} layout="vertical">
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
            tooltip="What the vendor calls it. The numbers below are what the system computes with."
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
              label="Within days"
              tooltip="Days from the bill date in which that discount can be taken."
            >
              <InputNumber min={0} max={365} style={{ width: 130 }} />
            </Form.Item>
          </Space>
          <Form.Item name="ap_account_id" label="Accounts Payable account (optional)">
            <Select allowClear options={apAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
          <Form.Item name="default_expense_account_id" label="Default expense account (optional)">
            <Select allowClear options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
        </Form>
      </Modal>

      <VendorTaxDrawer
        open={!!taxFor}
        vendor={taxFor}
        boxes={boxes}
        canManage={canManageTax}
        onClose={() => setTaxFor(null)}
      />
    </>
  );
}
