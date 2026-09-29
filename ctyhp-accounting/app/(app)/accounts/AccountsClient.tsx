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
import { CheckOutlined, EditOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import FilterBar from "@/components/ui/FilterBar";
import ClassifyAccountsButton from "./ClassifyAccountsButton";
import IconActionButton from "@/components/ui/IconActionButton";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  accountNormalBalance,
  statementSectionOf,
  type AccountType,
} from "@/lib/domain/accounts";
import { detailLabel, detailTypeOptions } from "@/lib/domain/account-detail";
import { accountSections, parentChoices, withAncestors, type AccountTreeRow } from "@/lib/domain/account-sections";
import { CASH_FLOW_ROLES, defaultCashFlowRole, type CashFlowRole } from "@/lib/domain/cashflow";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import { createAccountAction, updateAccountAction, setAccountStatusAction } from "./actions";
import styles from "./accounts.module.css";

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

type Row = AccountTreeRow<AccountRow>;

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role?: CashFlowRole;
  /** Offered for bank and current-asset types; see lib/domain/account-detail. */
  detail_type?: string | null;
  is_contra: boolean;
  parent_account_id?: string | null;
  currency_code?: string | null;
  default_tax_code_id?: string | null;
  is_posting_account: boolean;
  description?: string | null;
}

/**
 * The chart of accounts, read by section — bank accounts, receivables and
 * inventory, non-current assets, liabilities, equity, income, cost of goods
 * sold, expenses — each a tree of sub-accounts under their parent in number
 * order (lib/domain/account-sections.ts).
 */
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
  const watchedType = Form.useWatch("account_type", form);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [cashFlowFilter, setCashFlowFilter] = useState<CashFlowRole | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const filtering = search.trim() !== "" || typeFilter !== "all" || cashFlowFilter !== "all";

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        (typeFilter === "all" || a.account_type === typeFilter) &&
        (cashFlowFilter === "all" || a.cash_flow_role === cashFlowFilter) &&
        (!q || a.account_code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)),
    );
  }, [accounts, search, typeFilter, cashFlowFilter]);

  // A match reads in its section under its parent, so the parents above it come along.
  const sections = useMemo(
    () => accountSections(filtering ? withAncestors(accounts, matches) : accounts),
    [accounts, matches, filtering],
  );

  const labelById = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.account_code} — ${a.name}`])),
    [accounts],
  );

  const detailOptions = watchedType ? detailTypeOptions(watchedType) : [];

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency_code: "USD", is_posting_account: true, is_contra: false });
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
      is_contra: row.is_contra,
      parent_account_id: row.parent_account_id,
      currency_code: row.currency_code,
      default_tax_code_id: row.default_tax_code_id,
      is_posting_account: row.is_posting_account,
      description: row.description,
    });
    setOpen(true);
  }

  function onTypeChange(type: AccountType) {
    form.setFieldValue("cash_flow_role", defaultCashFlowRole(type));
    const detail = form.getFieldValue("detail_type") as string | null | undefined;
    if (!detailTypeOptions(type).some((o) => o.value === detail)) form.setFieldValue("detail_type", null);
    const parentId = form.getFieldValue("parent_account_id") as string | null | undefined;
    if (parentId && accounts.find((a) => a.id === parentId)?.account_type !== type) {
      form.setFieldValue("parent_account_id", null);
    }
  }

  async function onSubmit() {
    const values = await form.validateFields();
    setSaving(true);
    const result = editing ? await updateAccountAction(editing.id, values) : await createAccountAction(values);
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

  const columns: TableColumnsType<Row> = [
    {
      title: "Code",
      key: "code",
      width: COLUMN.CODE,
      render: (_: unknown, { account }: Row) => account.account_code,
    },
    {
      ...flexColumn<Row>({
        title: "Account name",
        key: "name",
        render: (_: unknown, { account, depth }: Row) => {
          const under = [
            detailLabel(account.account_type, account.detail_type),
            CASH_FLOW_ROLE_LABELS[account.cash_flow_role],
            accountNormalBalance(account.account_type, account.is_contra) === "debit" ? "Debit normal" : "Credit normal",
            statementSectionOf(account.account_type) === "balance_sheet" ? "Balance Sheet" : "Profit & Loss",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div style={{ minWidth: 0, paddingLeft: depth * 20 }}>
              <span title={account.name}>
                {depth > 0 ? <span className={styles.subMark}>↳</span> : null}
                {account.name}
              </span>
              {account.is_contra ? (
                <Tag color="purple" style={{ marginInlineStart: 8 }}>
                  Contra
                </Tag>
              ) : null}
              {secondaryLine(under)}
            </div>
          );
        },
      }),
    },
    {
      title: "Type",
      key: "type",
      width: 150,
      render: (_: unknown, { account }: Row) => <Tag>{ACCOUNT_TYPE_LABEL[account.account_type]}</Tag>,
    },
    {
      title: "Cash flow",
      key: "cashFlow",
      width: COLUMN.STATUS,
      render: (_: unknown, { account }: Row) =>
        account.cash_flow_role === "unclassified" ? <Tag color="orange">Unclassified</Tag> : <Tag color="blue">Set</Tag>,
    },
    {
      title: "Status",
      key: "status",
      width: COLUMN.STATUS,
      render: (_: unknown, { account }: Row) => (
        <Tag color={STATUS_LABELS[account.status].color}>{STATUS_LABELS[account.status].text}</Tag>
      ),
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
            render: (_: unknown, { account }: Row) => (
              <Space size={4}>
                <IconActionButton label="Edit account" icon={<EditOutlined />} onClick={() => openEdit(account)} />
                <IconActionButton
                  label={account.status === "active" ? "Deactivate account" : "Activate account"}
                  icon={account.status === "active" ? <StopOutlined /> : <CheckOutlined />}
                  loading={busyId === account.id}
                  onClick={() => toggleStatus(account)}
                  disabled={account.status !== "active" && account.status !== "inactive"}
                />
              </Space>
            ),
          } as TableColumnsType<Row>[number],
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        resultCount={matches.length}
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
          style={{ width: 260 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select<AccountType | "all">
          aria-label="Account type"
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 180 }}
          popupMatchSelectWidth={false}
          options={[
            { value: "all", label: "All types" },
            ...ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })),
          ]}
        />
        {/* How a reader finds every unclassified account — the one question the cash flow column is asked. */}
        <Select<CashFlowRole | "all">
          aria-label="Cash flow role"
          value={cashFlowFilter}
          onChange={setCashFlowFilter}
          style={{ width: 200 }}
          popupMatchSelectWidth={false}
          options={[
            { value: "all", label: "All cash flow roles" },
            ...CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] })),
          ]}
        />
      </FilterBar>

      {sections.length === 0 ? (
        <DataTable<Row>
          rowKey={(row) => row.account.id}
          columns={columns}
          dataSource={[]}
          pagination={false}
          emptyTitle={filtering ? "No matching accounts" : "No accounts yet"}
          emptyDescription={
            filtering
              ? "Try a different account code, name, type or cash flow role."
              : "Create an account to start building the chart of accounts."
          }
        />
      ) : (
        sections.map((section) => (
          <section key={section.key} className={styles.section} aria-labelledby={`coa-${section.key}`}>
            <div className={styles.sectionHead}>
              <h2 id={`coa-${section.key}`} className={styles.sectionTitle}>
                {section.title}
              </h2>
              <span className={styles.sectionCount}>
                {section.rows.length} {section.rows.length === 1 ? "account" : "accounts"}
              </span>
            </div>
            <DataTable<Row>
              rowKey={(row) => row.account.id}
              columns={columns}
              dataSource={section.rows}
              pagination={false}
            />
          </section>
        ))
      )}

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
          <Form.Item name="account_code" label="Account code" rules={[{ required: true, message: "Enter an account code" }]}>
            <Input disabled={!!editing} placeholder="e.g. 4000" />
          </Form.Item>
          <Form.Item name="name" label="Account name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input placeholder="e.g. Sales Revenue" />
          </Form.Item>
          <Form.Item name="account_type" label="Account type" rules={[{ required: true, message: "Select a type" }]}>
            <Select
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))}
              placeholder="Select an account type"
              onChange={onTypeChange}
            />
          </Form.Item>
          <Form.Item
            name="cash_flow_role"
            label="Cash flow role"
            rules={[{ required: true, message: "Select a cash flow role" }]}
            extra="Unclassified accounts keep the Cash Flow Statement in review status until an accountant assigns a policy."
          >
            <Select
              options={CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] }))}
              placeholder="Select a cash flow role"
            />
          </Form.Item>
          {detailOptions.length > 0 ? (
            <Form.Item
              name="detail_type"
              label={watchedType === "bank" ? "Bank account detail" : "Detail"}
              rules={watchedType === "bank" ? [{ required: true, message: "Say which kind of account this is" }] : []}
              extra={
                watchedType === "bank"
                  ? "Cash on hand is physical cash; everything else is held at a financial institution."
                  : "Undeposited funds and transfer clearing are money on its way to a bank; the chart shows them with the bank accounts."
              }
            >
              <Select allowClear={watchedType !== "bank"} placeholder="Choose a detail" options={detailOptions} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="parent_account_id"
            label="Parent account (optional)"
            extra="A sub-account has its parent's type, so only accounts of this type are offered."
          >
            <Select
              allowClear
              showSearch
              filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              placeholder="None"
              options={parentChoices(accounts, watchedType, editing?.id ?? null).map((a) => ({
                value: a.id,
                label: labelById.get(a.id)!,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="is_contra"
            label="Contra account"
            valuePropName="checked"
            tooltip="An account that reduces another in its section — Accumulated Depreciation, Sales Returns, Owner's Draw. Its balance runs the other way, and the Exception Report does not question it for that."
          >
            <Switch />
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
