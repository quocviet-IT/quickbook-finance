"use client";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { PlusOutlined, EditOutlined } from "@ant-design/icons";
import { ACCOUNT_TYPES, normalBalanceOf, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import { createAccountAction, updateAccountAction, setAccountStatusAction } from "./actions";

const TYPE_LABELS: Record<AccountType, string> = {
  bank: "Tiền/Ngân hàng",
  accounts_receivable: "Phải thu khách hàng",
  current_asset: "Tài sản ngắn hạn",
  fixed_asset: "Tài sản cố định",
  accounts_payable: "Phải trả người bán",
  credit_card: "Thẻ tín dụng",
  current_liability: "Nợ ngắn hạn",
  equity: "Vốn chủ sở hữu",
  income: "Doanh thu",
  cost_of_goods_sold: "Giá vốn hàng bán",
  expense: "Chi phí",
  other_income: "Thu nhập khác",
  other_expense: "Chi phí khác",
};

const STATUS_LABELS: Record<AccountStatus, { text: string; color: string }> = {
  draft: { text: "Nháp", color: "default" },
  active: { text: "Đang dùng", color: "green" },
  inactive: { text: "Ngừng", color: "orange" },
  archived: { text: "Lưu trữ", color: "default" },
};

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  parent_account_id?: string | null;
  currency_code?: string | null;
  default_tax_code_id?: string | null;
  is_posting_account: boolean;
  description?: string | null;
}

export default function AccountsClient({
  accounts,
  currencies,
  taxCodes,
  canWrite,
}: {
  accounts: AccountRow[];
  currencies: CurrencyRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.account_code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const nameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.account_code} — ${a.name}`])),
    [accounts],
  );

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_posting_account: true });
    setOpen(true);
  }

  function openEdit(row: AccountRow) {
    setEditing(row);
    form.setFieldsValue({
      account_code: row.account_code,
      name: row.name,
      account_type: row.account_type,
      parent_account_id: row.parent_account_id,
      currency_code: row.currency_code,
      default_tax_code_id: row.default_tax_code_id,
      is_posting_account: row.is_posting_account,
      description: row.description,
    });
    setOpen(true);
  }

  async function onSubmit() {
    const values = await form.validateFields();
    setSaving(true);
    const result = editing
      ? await updateAccountAction(editing.id, values)
      : await createAccountAction(values);
    setSaving(false);
    if (result.ok) {
      message.success(editing ? "Đã cập nhật tài khoản" : "Đã tạo tài khoản");
      setOpen(false);
    } else {
      message.error(result.error ?? "Lưu thất bại");
    }
  }

  async function toggleStatus(row: AccountRow) {
    const next: AccountStatus = row.status === "active" ? "inactive" : "active";
    setBusyId(row.id);
    const result = await setAccountStatusAction(row.id, next);
    setBusyId(null);
    if (result.ok) message.success(next === "active" ? "Đã kích hoạt" : "Đã ngừng sử dụng");
    else message.error(result.error ?? "Cập nhật trạng thái thất bại");
  }

  const columns: TableColumnsType<AccountRow> = [
    { title: "Mã", dataIndex: "account_code", width: 90, sorter: (a, b) => a.account_code.localeCompare(b.account_code) },
    {
      title: "Tên tài khoản",
      dataIndex: "name",
      render: (name: string, row) => (
        <span>
          {row.parent_account_id ? <span style={{ color: "#999" }}>↳ </span> : null}
          {name}
        </span>
      ),
    },
    {
      title: "Loại",
      dataIndex: "account_type",
      render: (t: AccountType) => <Tag>{TYPE_LABELS[t]}</Tag>,
      filters: ACCOUNT_TYPES.map((t) => ({ text: TYPE_LABELS[t], value: t })),
      onFilter: (value, row) => row.account_type === value,
    },
    {
      title: "Dư",
      dataIndex: "account_type",
      key: "normal",
      width: 70,
      render: (t: AccountType) => (normalBalanceOf(t) === "debit" ? "Nợ" : "Có"),
    },
    {
      title: "Báo cáo",
      dataIndex: "account_type",
      key: "statement",
      width: 130,
      render: (t: AccountType) =>
        statementSectionOf(t) === "balance_sheet" ? "Cân đối KT" : "Kết quả KD",
    },
    { title: "Tiền tệ", dataIndex: "currency_code", width: 80, render: (c) => c ?? "—" },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 110,
      render: (s: AccountStatus) => <Tag color={STATUS_LABELS[s].color}>{STATUS_LABELS[s].text}</Tag>,
    },
    ...(canWrite
      ? [
          {
            title: "Thao tác",
            key: "actions",
            width: 170,
            render: (_: unknown, row: AccountRow) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                  Sửa
                </Button>
                <Button
                  size="small"
                  loading={busyId === row.id}
                  onClick={() => toggleStatus(row)}
                  disabled={row.status !== "active" && row.status !== "inactive"}
                >
                  {row.status === "active" ? "Ngừng" : "Kích hoạt"}
                </Button>
              </Space>
            ),
          } as TableColumnsType<AccountRow>[number],
        ]
      : []),
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Input.Search
          placeholder="Tìm theo mã hoặc tên"
          allowClear
          style={{ width: 320 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Tạo tài khoản
          </Button>
        )}
      </Space>

      <Table<AccountRow>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
        sticky
      />

      <Modal
        title={editing ? "Sửa tài khoản" : "Tạo tài khoản"}
        open={open}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Hủy"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="account_code"
            label="Mã tài khoản"
            rules={[{ required: true, message: "Nhập mã tài khoản" }]}
          >
            <Input disabled={!!editing} placeholder="Ví dụ: 4000" />
          </Form.Item>
          <Form.Item name="name" label="Tên tài khoản" rules={[{ required: true, message: "Nhập tên" }]}>
            <Input placeholder="Ví dụ: Doanh thu bán hàng" />
          </Form.Item>
          <Form.Item name="account_type" label="Loại tài khoản" rules={[{ required: true, message: "Chọn loại" }]}>
            <Select
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
              placeholder="Chọn loại tài khoản"
            />
          </Form.Item>
          <Form.Item name="parent_account_id" label="Tài khoản cha (tùy chọn)">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Không có"
              options={accounts
                .filter((a) => a.id !== editing?.id)
                .map((a) => ({ value: a.id, label: nameById.get(a.id)! }))}
            />
          </Form.Item>
          <Form.Item name="currency_code" label="Tiền tệ">
            <Select
              allowClear
              placeholder="Mặc định theo hệ thống"
              options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="default_tax_code_id" label="Mã thuế mặc định (tùy chọn)">
            <Select
              allowClear
              placeholder="Không có"
              options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </Form.Item>
          <Form.Item name="is_posting_account" label="Tài khoản ghi sổ" valuePropName="checked" tooltip="Tắt nếu đây là tài khoản tổng hợp (không ghi bút toán trực tiếp)">
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
