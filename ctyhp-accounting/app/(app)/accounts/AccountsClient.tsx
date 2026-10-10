"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  type TableColumnsType,
} from "antd";
import { CheckOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "@/components/PageHeader";
import ZoomSheet from "@/components/reports/ZoomSheet";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import { COLUMN } from "@/lib/design/table-metrics";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  accountNormalBalance,
  statementSectionOf,
  type AccountType,
} from "@/lib/domain/accounts";
import { detailLabel, detailTypeOptions } from "@/lib/domain/account-detail";
import { parentChoices } from "@/lib/domain/account-sections";
import { CASH_FLOW_ROLES, defaultCashFlowRole, type CashFlowRole } from "@/lib/domain/cashflow";
import {
  CHART_FILTERS,
  chartClassOf,
  chartLede,
  chartRange,
  chartZoomSpec,
  groupRangeLabel,
  statementOf,
  type ChartClass,
} from "@/lib/domain/chart-groups";
import {
  chartFigureSpoken,
  chartFigureText,
  chartListing,
  chartViewHref,
  fiscalStartMonthOf,
  isRetired,
  openAccountLabel,
  type ChartFilter,
  type ChartListRow,
  type ChartView,
} from "@/lib/domain/chart-list";
import { shortDate } from "@/lib/domain/report-presets";
import type { ZoomSpec } from "@/lib/domain/statement";
import { formatMoney } from "@/lib/format";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import type { ChartBalances } from "@/lib/services/chart-balances";
import ClassifyAccountsButton from "./ClassifyAccountsButton";
import {
  chartBalancesAction,
  createAccountAction,
  updateAccountAction,
  setAccountStatusAction,
} from "./actions";
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

const CLASS_LABEL: Record<ChartClass, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/**
 * Column widths. The Account column carries none and takes what is left, never
 * less than ACCOUNT_FLOOR; tests/unit/accounts-screen adds each view's fixed
 * widths up against the 984px box at a 1280px window.
 */
export const CODE_WIDTH = COLUMN.CODE;
export const CURRENCY_WIDTH = 84;
/** Room for `($1,234,567.89)`: a seven-figure balance the wrong way round. */
export const BALANCE_WIDTH = 140;
export const TYPE_WIDTH = 150;
export const ACTIONS_WIDTH = COLUMN.ACTION * 2;
export const ACCOUNT_FLOOR = COLUMN.TEXT_MIN;
/** Balances: Code, Currency, Balance. */
export const BALANCES_FIXED_WIDTHS = [CODE_WIDTH, CURRENCY_WIDTH, BALANCE_WIDTH] as const;
/** Setup, for someone who can write: Code, Currency, Type, Cash flow, Status, Actions. */
export const SETUP_FIXED_WIDTHS = [CODE_WIDTH, CURRENCY_WIDTH, TYPE_WIDTH, COLUMN.STATUS, COLUMN.STATUS, ACTIONS_WIDTH] as const;

/**
 * The app's top bar: Ant Design's Layout header, 64px high and pinned at the
 * top of the page, which is the scrolling container. The filter bar pins under
 * it at the same 64px (app/globals.css), and a group's heading under both.
 */
const APP_HEADER_HEIGHT = 64;

type ListRow = ChartListRow<AccountRow>;

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
 * The chart of accounts as one grouped list, in the fourteen groups of
 * lib/domain/chart-groups.ts, each a tree of sub-accounts in code order.
 *
 * Balances, the default view, shows every account's figure at the As of date:
 * balance sheet accounts from the start of the books, profit and loss accounts
 * from the start of the fiscal year. The name or the figure opens QuickZoom on
 * the entries behind it. Setup shows the same list with type, cash flow and
 * status, and is where accounts are edited and deactivated.
 */
export default function AccountsClient({
  accounts,
  currencies,
  taxCodes,
  canWrite,
  initialView,
  initialBalances,
  baseCurrency,
  baseDecimals,
}: {
  accounts: AccountRow[];
  currencies: CurrencyRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
  initialView: ChartView;
  /** Read on the server at the company's today. */
  initialBalances: ChartBalances;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const watchedType = Form.useWatch("account_type", form);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [view, setView] = useState<ChartView>(initialView);
  // A link or the back button can change the view under a mounted page; follow it.
  const [viewFromServer, setViewFromServer] = useState<ChartView>(initialView);
  if (viewFromServer !== initialView) {
    setViewFromServer(initialView);
    setView(initialView);
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChartFilter>("all");
  const [cashFlowFilter, setCashFlowFilter] = useState<CashFlowRole | "all">("all");

  const [balances, setBalances] = useState<ChartBalances>(initialBalances);
  /** The date asked for while its figures are on their way; null when the figures shown are for the date shown. */
  const [requestedAsOf, setRequestedAsOf] = useState<string | null>(null);
  const latestRun = useRef(0);
  const [zoom, setZoom] = useState<ZoomSpec | null>(null);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);
  const inventoryAccountIds = useMemo(() => new Set(balances.inventoryAccountIds), [balances.inventoryAccountIds]);

  const listing = useMemo(
    () =>
      chartListing(accounts, {
        figures: balances.figures,
        inventoryAccountIds,
        view,
        search,
        filter,
        // How a reader finds every unclassified account: the one question the cash flow column is asked.
        keep: view === "setup" && cashFlowFilter !== "all" ? (a) => a.cash_flow_role === cashFlowFilter : undefined,
      }),
    [accounts, balances.figures, inventoryAccountIds, view, search, filter, cashFlowFilter],
  );

  const labelById = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.account_code} — ${a.name}`])),
    [accounts],
  );

  // A group's heading pins under the filter bar, which is pinned itself and
  // whose height follows what it holds. Measure it rather than guess.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const bar = root?.querySelector<HTMLElement>(".accounting-filter-bar");
    if (!root || !bar) return;
    const place = () => root.style.setProperty("--coa-pin-top", `${APP_HEADER_HEIGHT + bar.offsetHeight}px`);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const detailOptions = watchedType ? detailTypeOptions(watchedType) : [];

  function changeView(next: ChartView) {
    setView(next);
    // In the address, so a reload or a link opens the same view. Written with
    // history.replaceState as lib/client/use-table-url-state.ts does: the rows
    // are already here, and router.replace would re-read every balance.
    window.history.replaceState(window.history.state, "", chartViewHref(next));
  }

  async function changeAsOf(date: dayjs.Dayjs | null) {
    if (!date) return;
    const next = date.format("YYYY-MM-DD");
    if (next === (requestedAsOf ?? balances.asOf)) return;
    const run = ++latestRun.current;
    setRequestedAsOf(next);
    try {
      const result = await chartBalancesAction(next);
      // A later date was picked while this one was being read: its answer wins.
      if (run !== latestRun.current) return;
      if (result.ok && result.data) setBalances(result.data);
      else message.error(result.error ?? "The balances could not be read for that date");
    } catch {
      if (run === latestRun.current) message.error("The balances could not be read for that date. Check the connection and try again.");
    } finally {
      if (run === latestRun.current) setRequestedAsOf(null);
    }
  }

  /** QuickZoom on the account's figure, over the same dates the figure covers, so the list adds up to it. */
  function openAccount(account: AccountRow) {
    const figure = balances.figures[account.id] ?? 0;
    const range = chartRange(statementOf(account.account_type), balances.asOf, fiscalStartMonthOf(balances.fiscalYearStart));
    setZoom(chartZoomSpec(account, range, figure));
  }

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

  const loading = requestedAsOf !== null;
  const balancesView = view === "balances";

  const groupHeading = (row: Extract<ListRow, { kind: "group" }>) => (
    <div className={styles.groupHead}>
      <span className={styles.groupTitle}>{row.title}</span>
      {balancesView && row.statement === "profit_and_loss" ? (
        <span className={styles.groupRange}>{groupRangeLabel(balances.fiscalYearStart)}</span>
      ) : null}
      <span className={styles.groupCount}>
        {row.count}
        <span className="accounting-sr-only">{row.count === 1 ? " account" : " accounts"}</span>
      </span>
    </div>
  );

  const nameCell = (account: AccountRow, depth: number) => {
    const under = [
      detailLabel(account.account_type, account.detail_type),
      CASH_FLOW_ROLE_LABELS[account.cash_flow_role],
      accountNormalBalance(account.account_type, account.is_contra) === "debit" ? "Debit normal" : "Credit normal",
      statementSectionOf(account.account_type) === "balance_sheet" ? "Balance Sheet" : "Profit & Loss",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div style={{ minWidth: 0, paddingLeft: depth * 18 }}>
        <div className={styles.nameLine}>
          {depth > 0 ? (
            <span className={styles.subMark} aria-hidden="true">
              ↳
            </span>
          ) : null}
          <button
            type="button"
            className={styles.nameLink}
            onClick={() => openAccount(account)}
            aria-label={openAccountLabel(account)}
            title={account.name}
          >
            {account.name}
          </button>
          {account.is_contra ? <Tag color="purple">Contra</Tag> : null}
          {balancesView && isRetired(account.status) ? (
            <Tag color={STATUS_LABELS[account.status].color}>{STATUS_LABELS[account.status].text}</Tag>
          ) : null}
        </div>
        {balancesView ? null : secondaryLine(under)}
      </div>
    );
  };

  const balanceCell = (account: AccountRow) => {
    const figure = balances.figures[account.id] ?? 0;
    if (figure === 0) return <span className={styles.zero}>{money(0)}</span>;
    return (
      <button
        type="button"
        className={`${styles.figure}${figure < 0 ? ` ${styles.negative}` : ""}`}
        onClick={() => openAccount(account)}
        aria-label={`${openAccountLabel(account)}, balance ${chartFigureSpoken(figure, money)}`}
        title="Open the entries behind this balance"
      >
        {chartFigureText(figure, money)}
      </button>
    );
  };

  const leading: TableColumnsType<ListRow> = [
    {
      title: "Code",
      key: "code",
      width: CODE_WIDTH,
      render: (_: unknown, row: ListRow) => {
        if (row.kind === "group") return groupHeading(row);
        const chartClass = chartClassOf(row.account.account_type);
        return (
          <span className={styles.code}>
            <span className={styles.dot} data-class={chartClass} title={CLASS_LABEL[chartClass]} aria-hidden="true" />
            {row.account.account_code}
          </span>
        );
      },
    },
    flexColumn<ListRow>({
      title: "Account",
      key: "name",
      floor: ACCOUNT_FLOOR,
      render: (_: unknown, row: ListRow) => (row.kind === "account" ? nameCell(row.account, row.depth) : null),
    }),
    {
      title: "Currency",
      key: "currency",
      width: CURRENCY_WIDTH,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? <span className={styles.currency}>{row.account.currency_code ?? baseCurrency}</span> : null,
    },
  ];

  const balanceColumns: TableColumnsType<ListRow> = [
    {
      title: (
        <span className={styles.balanceHead}>
          <span>Balance</span>
          <span>{shortDate(balances.asOf)}</span>
        </span>
      ),
      key: "balance",
      width: BALANCE_WIDTH,
      align: "right",
      render: (_: unknown, row: ListRow) => (row.kind === "account" ? balanceCell(row.account) : null),
    },
  ];

  const setupColumns: TableColumnsType<ListRow> = [
    {
      title: "Type",
      key: "type",
      width: TYPE_WIDTH,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? <Tag>{ACCOUNT_TYPE_LABEL[row.account.account_type]}</Tag> : null,
    },
    {
      title: "Cash flow",
      key: "cashFlow",
      width: COLUMN.STATUS,
      render: (_: unknown, row: ListRow) =>
        row.kind !== "account" ? null : row.account.cash_flow_role === "unclassified" ? (
          <Tag color="orange">Unclassified</Tag>
        ) : (
          <Tag color="blue">Set</Tag>
        ),
    },
    {
      title: "Status",
      key: "status",
      width: COLUMN.STATUS,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? (
          <Tag color={STATUS_LABELS[row.account.status].color}>{STATUS_LABELS[row.account.status].text}</Tag>
        ) : null,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: ACTIONS_WIDTH,
            align: "right" as const,
            render: (_: unknown, row: ListRow) =>
              row.kind !== "account" ? null : (
                <Space size={4}>
                  <IconActionButton label="Edit account" icon={<EditOutlined />} onClick={() => openEdit(row.account)} />
                  <IconActionButton
                    label={row.account.status === "active" ? "Deactivate account" : "Activate account"}
                    icon={row.account.status === "active" ? <StopOutlined /> : <CheckOutlined />}
                    loading={busyId === row.account.id}
                    onClick={() => toggleStatus(row.account)}
                    disabled={row.account.status !== "active" && row.account.status !== "inactive"}
                  />
                </Space>
              ),
          } as TableColumnsType<ListRow>[number],
        ]
      : []),
  ];

  const shown = [...leading, ...(balancesView ? balanceColumns : setupColumns)];
  // A group's heading is one cell across the whole row.
  const columns: TableColumnsType<ListRow> = shown.map((column, i) => ({
    ...column,
    onCell: (row: ListRow) => (row.kind === "group" ? { colSpan: i === 0 ? shown.length : 0 } : {}),
  }));

  const narrowed = search.trim() !== "" || filter !== "all" || (view === "setup" && cashFlowFilter !== "all");

  return (
    <div ref={rootRef} className={styles.root}>
      <PageHeader
        title="Chart of Accounts"
        description={chartLede(listing.total, listing.withBalance, balances.asOf)}
        actions={
          <Segmented<ChartView>
            aria-label="View"
            value={view}
            onChange={changeView}
            options={[
              { value: "balances", label: "Balances" },
              { value: "setup", label: "Setup" },
            ]}
          />
        }
      />

      <div className={styles.pills} role="group" aria-label="Account type">
        {CHART_FILTERS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={styles.pill}
            aria-pressed={filter === pill.key}
            onClick={() => setFilter(pill.key)}
          >
            {pill.label}{" "}
            <span className={styles.pillCount}>({listing.counts[pill.key]})</span>
          </button>
        ))}
      </div>

      <FilterBar
        resultCount={listing.matched}
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
        <Input
          aria-label="Search accounts"
          placeholder="Search by code or name"
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {balancesView ? (
          <>
            <label className={styles.field}>
              As of
              <DatePicker
                aria-label="As of"
                value={dayjs(requestedAsOf ?? balances.asOf)}
                allowClear={false}
                onChange={(d) => void changeAsOf(d)}
              />
            </label>
            <span className={styles.updating} aria-live="polite">
              {loading ? (
                <>
                  <Spin size="small" />
                  Updating balances…
                </>
              ) : null}
            </span>
          </>
        ) : (
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
        )}
      </FilterBar>

      <div className={`${styles.list}${loading ? ` ${styles.busy}` : ""}`} aria-busy={loading}>
        <DataTable<ListRow>
          rowKey={(row) => row.key}
          columns={columns}
          dataSource={listing.rows}
          // One continuous list: a page break would split a group from its heading.
          pagination={false}
          rowClassName={(row) => (row.kind === "group" ? styles.groupRow : styles.accountRow)}
          emptyTitle={narrowed ? "No accounts match that search" : "No accounts yet"}
          emptyDescription={
            narrowed
              ? "Try a different code or name, or another account type."
              : "Create an account to start building the chart of accounts."
          }
        />
      </div>

      <ZoomSheet spec={zoom} onClose={() => setZoom(null)} money={money} />

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
