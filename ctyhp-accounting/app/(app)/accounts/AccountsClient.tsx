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
  Tag,
  type TableColumnsType,
} from "antd";
import {
  CheckOutlined,
  EditOutlined,
  PlusOutlined,
  StopOutlined,
} from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import { ACCOUNT_TYPES, normalBalanceOf, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "@/lib/domain/bank-account-detail";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import { createAccountAction, updateAccountAction, setAccountStatusAction } from "./actions";

const TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  accounts_receivable: "Accounts Receivable",
  current_asset: "Current Asset",
  fixed_asset: "Fixed Asset",
  accounts_payable: "Accounts Payable",
  credit_card: "Credit Card",
  current_liability: "Current Liability",
  equity: "Equity",
  income: "Income",
  cost_of_goods_sold: "Cost of Goods Sold",
  expense: "Expense",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

const STATUS_LABELS: Record<AccountStatus, { text: string; color: string }> = {
  draft: { text: "Draft", color: "default" },
  active: { text: "Active", color: "green" },
  inactive: { text: "Inactive", color: "orange" },
  archived: { text: "Archived", color: "default" },
};

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  /** Only meaningful for Bank-type accounts; see lib/domain/bank-account-detail. */
  detail_type?: string | null;
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
  // The bank detail picker only appears once the type says it is a bank account.
  const watchedType = Form.useWatch("account_type", form);
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
    form.setFieldsValue({ currency_code: "USD", is_posting_account: true });
    setOpen(true);
  }

  function openEdit(row: AccountRow) {
    setEditing(row);
    form.setFieldsValue({
      account_code: row.account_code,
      name: row.name,
      account_type: row.account_type,
      detail_type: row.detail_type,
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
      message.success(editing ? "Account updated" : "Account created");
      setOpen(false);
    } else {
      message.error(result.error ?? "Save failed");
    }
  }

  async function toggleStatus(row: AccountRow) {
    const next: AccountStatus = row.status === "active" ? "inactive" : "active";
    setBusyId(row.id);
    const result = await setAccountStatusAction(row.id, next);
    setBusyId(null);
    if (result.ok) message.success(next === "active" ? "Account activated" : "Account deactivated");
    else message.error(result.error ?? "Failed to update status");
  }

  const columns: TableColumnsType<AccountRow> = [
    { title: "Code", dataIndex: "account_code", width: 90, sorter: (a, b) => a.account_code.localeCompare(b.account_code) },
    {
      title: "Account name",
      dataIndex: "name",
      render: (name: string, row) => (
        <span>
          {row.parent_account_id ? <span style={{ color: "#999" }}>↳ </span> : null}
          {name}
        </span>
      ),
    },
    {
      title: "Type",
      dataIndex: "account_type",
      render: (t: AccountType) => <Tag>{TYPE_LABELS[t]}</Tag>,
      filters: ACCOUNT_TYPES.map((t) => ({ text: TYPE_LABELS[t], value: t })),
      onFilter: (value, row) => row.account_type === value,
    },
    {
      title: "Detail",
      dataIndex: "detail_type",
      width: 160,
      render: (detail: string | null, row) =>
        row.account_type === "bank" ? (
          <Tag color={detail ? "blue" : "orange"}>{bankDetailLabel(detail)}</Tag>
        ) : (
          (detail ?? "—")
        ),
    },
    {
      title: "Normal",
      dataIndex: "account_type",
      key: "normal",
      width: 80,
      render: (t: AccountType) => (normalBalanceOf(t) === "debit" ? "Debit" : "Credit"),
    },
    {
      title: "Statement",
      dataIndex: "account_type",
      key: "statement",
      width: 140,
      render: (t: AccountType) =>
        statementSectionOf(t) === "balance_sheet" ? "Balance Sheet" : "Profit & Loss",
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 110,
      render: (s: AccountStatus) => <Tag color={STATUS_LABELS[s].color}>{STATUS_LABELS[s].text}</Tag>,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: 90,
            render: (_: unknown, row: AccountRow) => (
              <Space size={4}>
                <IconActionButton
                  label="Edit account"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(row)}
                />
                <IconActionButton
                  label={row.status === "active" ? "Deactivate account" : "Activate account"}
                  icon={row.status === "active" ? <StopOutlined /> : <CheckOutlined />}
                  loading={busyId === row.id}
                  onClick={() => toggleStatus(row)}
                  disabled={row.status !== "active" && row.status !== "inactive"}
                />
              </Space>
            ),
          } as TableColumnsType<AccountRow>[number],
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        resultCount={filtered.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New account
            </Button>
          ) : null
        }
      >
        <Input.Search
          placeholder="Search by code or name"
          allowClear
          style={{ width: 320 }}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>

      <DataTable<AccountRow>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        sticky
        emptyTitle={search ? "No matching accounts" : "No accounts yet"}
        emptyDescription={
          search
            ? "Try a different account code or name."
            : "Create an account to start building the chart of accounts."
        }
      />

      <Modal
        title={editing ? "Edit account" : "New account"}
        open={open}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Save"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="account_code"
            label="Account code"
            rules={[{ required: true, message: "Enter an account code" }]}
          >
            <Input disabled={!!editing} placeholder="e.g. 4000" />
          </Form.Item>
          <Form.Item name="name" label="Account name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input placeholder="e.g. Sales Revenue" />
          </Form.Item>
          <Form.Item name="account_type" label="Account type" rules={[{ required: true, message: "Select a type" }]}>
            <Select
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
              placeholder="Select an account type"
            />
          </Form.Item>
          {watchedType === "bank" ? (
            <Form.Item
              name="detail_type"
              label="Bank account detail"
              rules={[{ required: true, message: "Say which kind of account this is" }]}
              extra="Cash on hand is physical cash; everything else is held at a financial institution."
            >
              <Select
                placeholder="Checking, savings, money market, cash on hand…"
                options={BANK_DETAIL_TYPES.map((detail) => ({
                  value: detail,
                  label: bankDetailLabel(detail),
                }))}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="parent_account_id" label="Parent account (optional)">
            <Select
              allowClear
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
              placeholder="None"
              options={accounts
                .filter((a) => a.id !== editing?.id)
                .map((a) => ({ value: a.id, label: nameById.get(a.id)! }))}
            />
          </Form.Item>
          <Form.Item name="currency_code" label="Currency">
            <Select
              disabled
              placeholder="USD"
              options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="default_tax_code_id" label="Default tax code (optional)">
            <Select
              allowClear
              placeholder="None"
              options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </Form.Item>
          <Form.Item
            name="is_posting_account"
            label="Posting account"
            valuePropName="checked"
            tooltip="Turn off for a summary account that does not receive direct postings"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
