"use client";
import { useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, VendorRow } from "@/lib/db/types";
import { createVendorAction } from "./actions";

export default function VendorsClient({
  vendors,
  apAccounts,
  expenseAccounts,
  canWrite,
}: {
  vendors: VendorRow[];
  apAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New vendor
          </Button>
        )}
      </Space>
      <Table<VendorRow>
        rowKey="id"
        dataSource={vendors}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Email", dataIndex: "email", render: (v) => v ?? "—" },
          { title: "Phone", dataIndex: "phone", render: (v) => v ?? "—" },
          { title: "Terms", dataIndex: "payment_terms", render: (v) => v ?? "—" },
          {
            title: "Status",
            dataIndex: "is_active",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
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
          <Form.Item name="payment_terms" label="Payment terms">
            <Input placeholder="e.g. Net 30" />
          </Form.Item>
          <Form.Item name="ap_account_id" label="A/P account (optional)">
            <Select allowClear options={apAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
          <Form.Item name="default_expense_account_id" label="Default expense account (optional)">
            <Select allowClear options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
