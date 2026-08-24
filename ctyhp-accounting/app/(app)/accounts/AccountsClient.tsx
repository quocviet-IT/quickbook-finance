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
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import FilterBar from "@/components/ui/FilterBar";
import ClassifyAccountsButton from "./ClassifyAccountsButton";
import IconActionButton from "@/components/ui/IconActionButton";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  normalBalanceOf,
  statementSectionOf,
  type AccountType,
} from "@/lib/domain/accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "@/lib/domain/bank-account-detail";
import {
  CASH_FLOW_ROLES,
  defaultCashFlowRole,
  type CashFlowRole,
} from "@/lib/domain/cashflow";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import { createAccountAction, updateAccountAction, setAccountStatusAction } from "./actions";
import { TOKENS } from "@/lib/design/tokens";

const STATUS_LABELS: Record<AccountStatus, { text: string; color: string }> = {
  draft: { text: "Draft", color: "default" },
  active: { text: "Active", color: "green" },
  inactive: { text: "Inactive", color: "orange" },
  archived: { text: "Archived", color: "default" },
};

const CASH_FLOW_ROLE_LABELS: Record<CashFlowRole, string> = {
  cash: "Cash",
  cash_equivalent: "Cash equivalent",
  restricted_cash: "Restricted cash",
  operating: "Operating",
  operating_receivable: "Operating — receivable",
  operating_inventory: "Operating — inventory",
  operating_payable: "Operating — payable",
  operating_asset: "Operating — other asset",
  operating_liability: "Operating — other liability",
  investing: "Investing",
  financing: "Financing",
  exclude: "Exclude",
  unclassified: "Unclassified",
};

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role?: CashFlowRole;
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
      cash_flow_role: row.cash_flow_role,
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
    {
      title: "Code",
      dataIndex: "account_code",
      width: COLUMN.CODE,
      sorter: (a, b) => a.account_code.localeCompare(b.account_code),
    },
    {
      // The elastic column. Four columns used to follow it — Detail, Cash
      // flow, Normal and Statement, 570px between them — each printing a fact
      // derived from the account's own type. They read under the name now,
      // where they qualify it, and the table fits the screen.
      ...flexColumn<AccountRow>({
        title: "Account name",
        key: "name",
        render: (_: unknown, row: AccountRow) => {
          const detail =
            row.account_type === "bank" ? bankDetailLabel(row.detail_type) : row.detail_type;
          const under = [
            detail,
            CASH_FLOW_ROLE_LABELS[row.cash_flow_role],
            normalBalanceOf(row.account_type) === "debit" ? "Debit normal" : "Credit normal",
            statementSectionOf(row.account_type) === "balance_sheet"
              ? "Balance Sheet"
              : "Profit & Loss",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div style={{ minWidth: 0 }}>
              <span title={row.name}>
                {row.parent_account_id ? (
                  <span style={{ color: TOKENS.text.secondary }}>↳ </span>
                ) : null}
                {row.name}
              </span>
              {secondaryLine(under)}
            </div>
          );
        },
      }),
      sorter: (a: AccountRow, b: AccountRow) => a.name.localeCompare(b.name),
    },
    {
      title: "Type",
      dataIndex: "account_type",
      width: 150,
      render: (t: AccountType) => <Tag>{ACCOUNT_TYPE_LABEL[t]}</Tag>,
      filters: ACCOUNT_TYPES.map((t) => ({ text: ACCOUNT_TYPE_LABEL[t], value: t })),
      onFilter: (value, row) => row.account_type === value,
    },
    {
      // The filter stays on the row even though the value now reads on the
      // second line: it is how a reader finds every unclassified account,
      // which is the one question this column is asked.
      title: "Cash flow",
      dataIndex: "cash_flow_role",
      width: COLUMN.STATUS,
      render: (role: CashFlowRole) =>
        role === "unclassified" ? <Tag color="orange">Unclassified</Tag> : <Tag color="blue">Set</Tag>,
      filters: CASH_FLOW_ROLES.map((role) => ({
        text: CASH_FLOW_ROLE_LABELS[role],
        value: role,
      })),
      onFilter: (value, row) => row.cash_flow_role === value,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: COLUMN.STATUS,
      render: (s: AccountStatus) => <Tag color={STATUS_LABELS[s].color}>{STATUS_LABELS[s].text}</Tag>,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
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
          <Space wrap>
            <ClassifyAccountsButton canWrite={canWrite} />
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New account
              </Button>
            ) : null}
          </Space>
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
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))}
              placeholder="Select an account type"
              onChange={(type: AccountType) => {
                form.setFieldValue("cash_flow_role", defaultCashFlowRole(type));
                if (type !== "bank") form.setFieldValue("detail_type", null);
              }}
            />
          </Form.Item>
          <Form.Item
            name="cash_flow_role"
            label="Cash flow role"
            rules={[{ required: true, message: "Select a cash flow role" }]}
            extra="Unclassified accounts keep the Cash Flow Statement in review status until an accountant assigns a policy."
          >
            <Select
              options={CASH_FLOW_ROLES.map((role) => ({
                value: role,
                label: CASH_FLOW_ROLE_LABELS[role],
              }))}
              placeholder="Select a cash flow role"
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
