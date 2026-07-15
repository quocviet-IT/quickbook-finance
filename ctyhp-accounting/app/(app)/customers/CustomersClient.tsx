"use client";
import { useState } from "react";
import { App, Button, Form, Input, Modal, Space, Table, Tag, type TableColumnsType } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { CustomerRow } from "@/lib/db/types";
import { createCustomerAction } from "./actions";

export default function CustomersClient({
  customers,
  canWrite,
}: {
  customers: CustomerRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await createCustomerAction(v);
    setSaving(false);
    if (res.ok) {
      message.success("Customer created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create customer");
    }
  }

  const columns: TableColumnsType<CustomerRow> = [
    { title: "Name", dataIndex: "name" },
    { title: "Email", dataIndex: "email", render: (e) => e ?? "—" },
    { title: "Currency", dataIndex: "currency_code", width: 100, render: (c) => c ?? "—" },
    {
      title: "Status",
      dataIndex: "is_active",
      width: 100,
      render: (a: boolean) => <Tag color={a ? "green" : "default"}>{a ? "Active" : "Inactive"}</Tag>,
    },
  ];

  return (
    <div>
      {canWrite && (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New customer
          </Button>
        </Space>
      )}
      <Table rowKey="id" columns={columns} dataSource={customers} size="small" pagination={{ pageSize: 20 }} sticky />

      <Modal
        title="New customer"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Save"
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
    </div>
  );
}
