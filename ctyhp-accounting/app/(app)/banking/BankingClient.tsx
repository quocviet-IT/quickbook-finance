"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  type TableColumnsType,
} from "antd";
import {
  BankOutlined,
  CloudSyncOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/PageStates";
import type { AccountRow, CurrencyRow, BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type {
  BankAccountWithGl,
  BankConnectionView,
  SuggestionView,
} from "@/lib/services/banking";
import { parseCsv } from "@/lib/csv";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  approveReconciliationAction,
  connectPlaidBankAction,
  createBankAccountAction,
  createPlaidLinkTokenAction,
  generateSuggestionsAction,
  getSuggestionsAction,
  getTransactionsAction,
  importStatementAction,
  rejectReconciliationAction,
  syncBankConnectionAction,
} from "./actions";

interface PlaidLinkAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

interface PlaidLinkMetadata {
  institution: { institution_id: string; name: string } | null;
  accounts: PlaidLinkAccount[];
}

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (options: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        onExit: (error: { display_message?: string; error_message?: string } | null) => void;
      }) => PlaidHandler;
    };
  }
}

const TXN_STATUS: Record<BankTxnStatus, { text: string; color: string }> = {
  unmatched: { text: "For review", color: "orange" },
  matched: { text: "Matched", color: "green" },
  ignored: { text: "Excluded", color: "default" },
};

function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return null;
}

function formatSyncTime(value: string | null): string {
  if (!value) return "Not synchronized yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

interface ParsedRow {
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string;
}

interface PendingPlaidLink {
  publicToken: string;
  institutionId: string | null;
  institutionName: string;
  accounts: PlaidLinkAccount[];
}

export default function BankingClient({
  bankAccounts,
  bankConnections,
  glBankAccounts,
  currencies,
  canWrite,
  plaidConfigured,
  plaidEnvironment,
}: {
  bankAccounts: BankAccountWithGl[];
  bankConnections: BankConnectionView[];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
  plaidConfigured: boolean;
  plaidEnvironment: string;
}) {
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string | undefined>(bankAccounts[0]?.id);
  const [tab, setTab] = useState<"transactions" | "reconcile">("transactions");
  const [txns, setTxns] = useState<BankTransactionRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [acctForm] = Form.useForm();
  const [acctOpen, setAcctOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");

  const [pendingLink, setPendingLink] = useState<PendingPlaidLink | null>(null);
  const [mappingSelections, setMappingSelections] = useState<Record<string, string | undefined>>({});
  const oauthResumeStarted = useRef(false);

  const selected = bankAccounts.find((account) => account.id === selectedId);
  const selectedConnection = bankConnections.find((connection) =>
    connection.accounts.some((account) => account.bank_account_id === selectedId),
  );
  const connectedBookAccountIds = useMemo(
    () => new Set(bankConnections.flatMap((connection) => connection.accounts.map((account) => account.bank_account_id))),
    [bankConnections],
  );
  const decimalsOf = (code: string) => currencies.find((currency) => currency.code === code)?.decimal_places ?? 2;
  const decimalPlaces = selected ? decimalsOf(selected.currency_code) : 2;
  const money = (value: number) =>
    selected ? formatMoney(value, selected.currency_code, decimalPlaces) : String(value);

  const reload = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    const [transactions, matches] = await Promise.all([
      getTransactionsAction(selectedId),
      getSuggestionsAction(selectedId),
    ]);
    setLoading(false);
    if (transactions.ok && transactions.data) setTxns(transactions.data);
    if (matches.ok && matches.data) setSuggestions(matches.data);
  }, [selectedId]);

  useEffect(() => {
    // Intentional synchronization after the selected account changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function submitAccount() {
    const values = await acctForm.validateFields();
    const result = await createBankAccountAction(values);
    if (result.ok) {
      message.success("Bank account created");
      setAcctOpen(false);
      acctForm.resetFields();
      window.location.reload();
    } else {
      message.error(result.error ?? "Failed to create bank account");
    }
  }

  function launchPlaidLink(linkToken: string, receivedRedirectUri?: string) {
    if (!window.Plaid) return;
    const handler = window.Plaid.create({
      token: linkToken,
      receivedRedirectUri,
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        sessionStorage.removeItem("ctyhp_plaid_link_token");
        if (receivedRedirectUri) window.history.replaceState({}, "", "/banking");
        if (!metadata.institution || !metadata.accounts.length) {
          message.error("No financial institution account was selected");
          return;
        }
        const initialSelections: Record<string, string | undefined> = {};
        for (const providerAccount of metadata.accounts) {
          const maskMatch = bankAccounts.find(
            (bookAccount) =>
              !connectedBookAccountIds.has(bookAccount.id) &&
              providerAccount.mask &&
              bookAccount.account_number_masked?.endsWith(providerAccount.mask),
          );
          initialSelections[providerAccount.id] = maskMatch?.id;
        }
        setMappingSelections(initialSelections);
        setPendingLink({
          publicToken,
          institutionId: metadata.institution.institution_id,
          institutionName: metadata.institution.name,
          accounts: metadata.accounts,
        });
      },
      onExit: (error) => {
        handler.destroy();
        if (error) message.error(error.display_message || error.error_message || "Bank connection was not completed");
      },
    });
    handler.open();
  }

  function resumePlaidOAuth() {
    if (oauthResumeStarted.current || !window.Plaid) return;
    const isOAuthReturn = new URLSearchParams(window.location.search).has("oauth_state_id");
    const linkToken = sessionStorage.getItem("ctyhp_plaid_link_token");
    if (!isOAuthReturn || !linkToken) return;
    oauthResumeStarted.current = true;
    launchPlaidLink(linkToken, window.location.href);
  }

  async function openPlaidLink() {
    if (!plaidConfigured) {
      message.error("Configure the Plaid credentials and bank-feed encryption key on the server first");
      return;
    }
    if (!window.Plaid) {
      message.error("The secure bank connection window is still loading. Try again in a moment.");
      return;
    }
    setBusy("plaid-link");
    const result = await createPlaidLinkTokenAction();
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to initialize the bank connection");
      return;
    }
    sessionStorage.setItem("ctyhp_plaid_link_token", result.data.linkToken);
    launchPlaidLink(result.data.linkToken);
  }

  async function confirmPlaidMapping() {
    if (!pendingLink) return;
    const mappings = pendingLink.accounts
      .map((account) => ({
        provider_account_id: account.id,
        bank_account_id: mappingSelections[account.id],
      }))
      .filter((mapping): mapping is { provider_account_id: string; bank_account_id: string } =>
        Boolean(mapping.bank_account_id),
      );
    if (!mappings.length) {
      message.error("Map at least one connected account to a ledger bank account");
      return;
    }
    if (new Set(mappings.map((mapping) => mapping.bank_account_id)).size !== mappings.length) {
      message.error("Each provider account must map to a different ledger account");
      return;
    }

    setBusy("plaid-save");
    const result = await connectPlaidBankAction({
      publicToken: pendingLink.publicToken,
      institutionId: pendingLink.institutionId,
      institutionName: pendingLink.institutionName,
      mappings,
    });
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to save the bank connection");
      return;
    }
    message.success(
      `Bank connected. Imported ${result.data.added} transaction(s) and created ${result.data.suggestions} match suggestion(s).`,
    );
    setPendingLink(null);
    window.location.reload();
  }

  async function synchronizeFeed() {
    if (!selectedConnection) return;
    setBusy("sync");
    const result = await syncBankConnectionAction(selectedConnection.id);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Bank feed synchronization failed");
      return;
    }
    message.success(
      `Synchronized: ${result.data.added} new, ${result.data.modified} updated, ` +
        `${result.data.removed} removed, ${result.data.suggestions} match suggestion(s).`,
    );
    window.location.reload();
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const records = parseCsv(String(reader.result));
      const rows: ParsedRow[] = [];
      let invalidRows = 0;
      for (const record of records) {
        const date = normalizeDate(record.date ?? record["transaction date"] ?? "");
        const amountValue = (record.amount ?? "").replace(/[^0-9.-]/g, "");
        if (!date || amountValue === "") {
          invalidRows++;
          continue;
        }
        rows.push({
          txn_date: date,
          description: record.description ?? record.memo ?? "",
          reference: record.reference ?? record.ref ?? null,
          amount_minor: toMinorUnits(parseFloat(amountValue), decimalPlaces),
          running_balance_minor: record.balance
            ? toMinorUnits(parseFloat(record.balance.replace(/[^0-9.-]/g, "")), decimalPlaces)
            : null,
          raw_line: Object.values(record).join(","),
        });
      }
      setParsed(rows);
      setFileName(file.name);
      if (invalidRows) message.warning(`${invalidRows} row(s) skipped because date or amount was missing`);
    };
    reader.readAsText(file);
    return false;
  }

  async function confirmImport() {
    if (!selectedId || !parsed.length) return;
    setBusy("import");
    const result = await importStatementAction(selectedId, fileName, parsed);
    setBusy(null);
    if (result.ok && result.data) {
      message.success(
        `Imported ${result.data.inserted} transaction(s); ${result.data.skipped} duplicate(s) skipped`,
      );
      setImportOpen(false);
      setParsed([]);
      reload();
    } else {
      message.error(result.error ?? "Import failed");
    }
  }

  async function findMatches() {
    if (!selectedId) return;
    setBusy("match");
    const result = await generateSuggestionsAction(selectedId);
    setBusy(null);
    if (result.ok && result.data) {
      message.success(`${result.data.count} new ledger match suggestion(s)`);
      setTab("reconcile");
      reload();
    } else {
      message.error(result.error ?? "Failed to find ledger matches");
    }
  }

  async function approve(id: string) {
    setBusy(id);
    const result = await approveReconciliationAction(id);
    setBusy(null);
    if (result.ok) {
      message.success("Match approved");
      reload();
    } else {
      message.error(result.error ?? "Failed to approve the match");
    }
  }

  async function reject(id: string) {
    setBusy(id);
    const result = await rejectReconciliationAction(id);
    setBusy(null);
    if (result.ok) reload();
    else message.error(result.error ?? "Failed to reject the match");
  }

  const transactionColumns: TableColumnsType<BankTransactionRow> = [
    { title: "Date", dataIndex: "txn_date", width: 115 },
    {
      title: "Description",
      dataIndex: "description",
      render: (description: string, row) => (
        <Space direction="vertical" size={0}>
          <span>{description}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.category ? row.category.replaceAll("_", " ") : row.source === "bank_feed" ? "Direct bank feed" : "File upload"}
          </Typography.Text>
        </Space>
      ),
    },
    { title: "Reference", dataIndex: "reference", width: 135, render: (reference) => reference ?? "—" },
    {
      title: "Amount",
      dataIndex: "amount_minor",
      width: 140,
      align: "right",
      render: (value: number) => (
        <span style={{ color: value < 0 ? "#b91c1c" : "#15803d" }}>{money(value)}</span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (status: BankTxnStatus, row) => (
        <Space size={4}>
          <Tag color={TXN_STATUS[status].color}>{TXN_STATUS[status].text}</Tag>
          {row.pending ? <Tag>Pending</Tag> : null}
        </Space>
      ),
    },
  ];

  const suggestionColumns: TableColumnsType<SuggestionView> = [
    { title: "Bank date", dataIndex: "txn_date", width: 110 },
    { title: "Bank description", dataIndex: "txn_description" },
    {
      title: "Ledger match",
      key: "target",
      width: 260,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.target_number ?? "Posted journal"}</Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
            {row.target_type.replaceAll("_", " ")}
            {row.target_description ? ` · ${row.target_description}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    { title: "Amount", dataIndex: "amount_minor", width: 130, align: "right", render: money },
    {
      title: "Confidence",
      dataIndex: "confidence",
      width: 115,
      render: (confidence: number) => {
        const percentage = Math.round(confidence * 100);
        return <Tag color={percentage >= 90 ? "green" : percentage >= 75 ? "gold" : "orange"}>{percentage}%</Tag>;
      },
    },
    ...(canWrite
      ? [
          {
            title: "Action",
            key: "action",
            width: 170,
            render: (_value: unknown, row: SuggestionView) => (
              <Space>
                <Button size="small" type="primary" loading={busy === row.id} onClick={() => approve(row.id)}>
                  Approve
                </Button>
                <Button size="small" loading={busy === row.id} onClick={() => reject(row.id)}>
                  Reject
                </Button>
              </Space>
            ),
          } as TableColumnsType<SuggestionView>[number],
        ]
      : []),
  ];

  if (!bankAccounts.length) {
    return (
      <>
        <EmptyState
          title="No bank accounts yet"
          description={
            glBankAccounts.length
              ? "Create the ledger bank account record before connecting a financial institution."
              : "Create a Bank-type account in the Chart of Accounts first."
          }
          action={
            canWrite ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  acctForm.setFieldsValue({ currency_code: "USD" });
                  setAcctOpen(true);
                }}
                disabled={!glBankAccounts.length}
              >
                Add bank account
              </Button>
            ) : null
          }
        />
        <CreateAccountModal
          open={acctOpen}
          onCancel={() => setAcctOpen(false)}
          onOk={submitAccount}
          form={acctForm}
          glBankAccounts={glBankAccounts}
          currencies={currencies}
        />
      </>
    );
  }

  const unmatchedCount = txns.filter((transaction) => transaction.status === "unmatched").length;

  return (
    <div>
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        strategy="afterInteractive"
        onReady={resumePlaidOAuth}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <BankOutlined style={{ fontSize: 20, color: "#0f766e" }} />
          <div>
            <Typography.Text strong>
              {selectedConnection ? selectedConnection.institution_name : "No direct feed for this account"}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {selectedConnection
                ? `Last sync: ${formatSyncTime(selectedConnection.last_sync_at)}`
                : "File import remains available until a bank is connected."}
            </Typography.Text>
          </div>
          {selectedConnection ? (
            <Tag color={selectedConnection.status === "active" ? "green" : "orange"}>
              {selectedConnection.status.replaceAll("_", " ")}
            </Tag>
          ) : null}
          {plaidEnvironment !== "production" ? <Tag color="blue">{plaidEnvironment}</Tag> : null}
        </Space>
        {selectedConnection?.last_error ? (
          <Alert type="warning" showIcon message="The last synchronization needs attention" description={selectedConnection.last_error} style={{ marginTop: 12 }} />
        ) : null}
        {!plaidConfigured && canWrite ? (
          <Alert
            type="info"
            showIcon
            message="Direct bank feed is ready for configuration"
            description="Set PLAID_CLIENT_ID, PLAID_SECRET, and BANK_FEED_ENCRYPTION_KEY in the server environment."
            style={{ marginTop: 12 }}
          />
        ) : null}
      </Card>

      <FilterBar
        resultCount={tab === "transactions" ? txns.length : suggestions.length}
        actions={
          canWrite ? (
            <Space wrap>
              {glBankAccounts.length > 0 ? (
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    acctForm.setFieldsValue({ currency_code: "USD" });
                    setAcctOpen(true);
                  }}
                >
                  Add account
                </Button>
              ) : null}
              {!selectedConnection ? (
                <Button
                  icon={<LinkOutlined />}
                  loading={busy === "plaid-link"}
                  disabled={!plaidConfigured}
                  onClick={openPlaidLink}
                >
                  Connect bank
                </Button>
              ) : (
                <Button icon={<CloudSyncOutlined />} loading={busy === "sync"} onClick={synchronizeFeed}>
                  Sync now
                </Button>
              )}
              {tab === "transactions" ? (
                <Button type="primary" icon={<InboxOutlined />} onClick={() => setImportOpen(true)}>
                  Import statement
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={busy === "match"}
                  onClick={findMatches}
                >
                  Find ledger matches
                </Button>
              )}
            </Space>
          ) : null
        }
      >
        <Space wrap>
          <Select
            style={{ minWidth: 280 }}
            value={selectedId}
            onChange={setSelectedId}
            options={bankAccounts.map((account) => ({
              value: account.id,
              label: `${account.bank_name || account.account_name} · ${account.account_code} (${account.currency_code})`,
            }))}
          />
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as "transactions" | "reconcile")}
            options={[
              { label: `For review${unmatchedCount ? ` (${unmatchedCount})` : ""}`, value: "transactions" },
              { label: `Suggested matches${suggestions.length ? ` (${suggestions.length})` : ""}`, value: "reconcile" },
            ]}
          />
        </Space>
      </FilterBar>

      {tab === "transactions" ? (
        <DataTable
          rowKey="id"
          columns={transactionColumns}
          dataSource={txns}
          pagination={{ pageSize: 25 }}
          sticky
          loading={loading}
          emptyTitle="No bank transactions"
          emptyDescription="Synchronize a bank feed or import a statement to start the review workflow."
        />
      ) : (
        <DataTable
          rowKey="id"
          columns={suggestionColumns}
          dataSource={suggestions}
          pagination={{ pageSize: 25 }}
          sticky
          loading={loading}
          emptyTitle="No ledger match suggestions"
          emptyDescription="Run matching to compare bank activity with posted General Ledger bank lines."
        />
      )}

      <Modal
        title="Import bank statement"
        open={importOpen}
        onOk={confirmImport}
        onCancel={() => {
          setImportOpen(false);
          setParsed([]);
        }}
        okText={parsed.length ? `Import ${parsed.length} rows` : "Import"}
        okButtonProps={{ disabled: !parsed.length, loading: busy === "import" }}
        cancelText="Cancel"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          Upload a comma-separated values file with columns: <code>date, description, amount, reference, balance</code>.
          Positive amounts are money in. Dates may use YYYY-MM-DD or MM/DD/YYYY.
        </Typography.Paragraph>
        <Upload.Dragger accept=".csv" beforeUpload={handleFile} maxCount={1} showUploadList={{ showRemoveIcon: false }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Click or drag a comma-separated values file here</p>
        </Upload.Dragger>
        {parsed.length > 0 ? (
          <Typography.Paragraph style={{ marginTop: 12 }}>
            Parsed <strong>{parsed.length}</strong> transactions from <strong>{fileName}</strong>.
          </Typography.Paragraph>
        ) : null}
      </Modal>

      <Modal
        title={`Map ${pendingLink?.institutionName ?? "bank"} accounts`}
        open={Boolean(pendingLink)}
        onOk={confirmPlaidMapping}
        onCancel={() => setPendingLink(null)}
        okText="Connect and synchronize"
        okButtonProps={{ loading: busy === "plaid-save" }}
        width={700}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="Map each external account to its matching General Ledger bank account."
          description="Unmapped accounts will not be imported. Currency must agree between the provider and the ledger."
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {pendingLink?.accounts.map((account) => (
            <div key={account.id}>
              <Typography.Text strong>
                {account.name}{account.mask ? ` ••••${account.mask}` : ""}
              </Typography.Text>
              <Typography.Text type="secondary"> · {account.type} / {account.subtype ?? "other"}</Typography.Text>
              <Select
                allowClear
                placeholder="Select General Ledger bank account"
                style={{ width: "100%", marginTop: 6 }}
                value={mappingSelections[account.id]}
                onChange={(value) =>
                  setMappingSelections((current) => ({ ...current, [account.id]: value }))
                }
                options={bankAccounts
                  .filter((bookAccount) => !connectedBookAccountIds.has(bookAccount.id))
                  .map((bookAccount) => ({
                    value: bookAccount.id,
                    label: `${bookAccount.account_code} — ${bookAccount.account_name} (${bookAccount.currency_code})`,
                  }))}
              />
            </div>
          ))}
        </Space>
      </Modal>

      <CreateAccountModal
        open={acctOpen}
        onCancel={() => setAcctOpen(false)}
        onOk={submitAccount}
        form={acctForm}
        glBankAccounts={glBankAccounts}
        currencies={currencies}
      />
    </div>
  );
}

function CreateAccountModal({
  open,
  onCancel,
  onOk,
  form,
  glBankAccounts,
  currencies,
}: {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  form: ReturnType<typeof Form.useForm>[0];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
}) {
  return (
    <Modal
      title="Add bank account"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText="Create"
      cancelText="Cancel"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="account_id"
          label="General Ledger bank account"
          rules={[{ required: true, message: "Select an account" }]}
        >
          <Select
            placeholder="Select a Bank-type account"
            options={glBankAccounts.map((account) => ({
              value: account.id,
              label: `${account.account_code} — ${account.name}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="bank_name" label="Bank name" rules={[{ required: true, message: "Enter the bank name" }]}>
          <Input placeholder="e.g. First National Bank" />
        </Form.Item>
        <Form.Item name="account_number_masked" label="Account number (masked)">
          <Input placeholder="e.g. ****1234" />
        </Form.Item>
        <Form.Item name="currency_code" label="Currency" rules={[{ required: true, message: "Select a currency" }]}>
          <Select
            disabled
            options={currencies.map((currency) => ({
              value: currency.code,
              label: `${currency.code} — ${currency.name}`,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
