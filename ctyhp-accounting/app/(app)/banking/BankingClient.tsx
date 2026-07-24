"use client";
import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
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
import { InboxOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/PageStates";
import type { AccountRow, CurrencyRow, BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type { BankAccountWithGl, SuggestionView } from "@/lib/services/banking";
import { parseCsv } from "@/lib/csv";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  createBankAccountAction,
  importStatementAction,
  getTransactionsAction,
  generateSuggestionsAction,
  getSuggestionsAction,
  approveReconciliationAction,
  rejectReconciliationAction,
} from "./actions";

const TXN_STATUS: Record<BankTxnStatus, { text: string; color: string }> = {
  unmatched: { text: "Unmatched", color: "orange" },
  matched: { text: "Matched", color: "green" },
  ignored: { text: "Ignored", color: "default" },
};

function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface ParsedRow {
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string;
}

export default function BankingClient({
  bankAccounts,
  glBankAccounts,
  currencies,
  canWrite,
}: {
  bankAccounts: BankAccountWithGl[];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string | undefined>(bankAccounts[0]?.id);
  const [tab, setTab] = useState<"transactions" | "reconcile">("transactions");
  const [txns, setTxns] = useState<BankTransactionRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // create account
  const [acctForm] = Form.useForm();
  const [acctOpen, setAcctOpen] = useState(false);

  // import
  const [importOpen, setImportOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");

  const selected = bankAccounts.find((b) => b.id === selectedId);
  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const dec = selected ? decimalsOf(selected.currency_code) : 2;
  const money = (v: number) => (selected ? formatMoney(v, selected.currency_code, dec) : String(v));

  const reload = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    const [t, s] = await Promise.all([getTransactionsAction(selectedId), getSuggestionsAction(selectedId)]);
    setLoading(false);
    if (t.ok && t.data) setTxns(t.data);
    if (s.ok && s.data) setSuggestions(s.data);
  }, [selectedId]);

  // Data-synchronization effect: refetch transactions/suggestions whenever the
  // selected bank account changes. reload() flips a loading flag then fetches
  // via server actions — an intentional load, not derived render state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function submitAccount() {
    const v = await acctForm.validateFields();
    const res = await createBankAccountAction(v);
    if (res.ok) {
      message.success("Bank account created");
      setAcctOpen(false);
      acctForm.resetFields();
      window.location.reload();
    } else {
      message.error(res.error ?? "Failed to create bank account");
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const records = parseCsv(String(reader.result));
      const rows: ParsedRow[] = [];
      let bad = 0;
      for (const rec of records) {
        const date = normalizeDate(rec.date ?? rec["transaction date"] ?? "");
        const amountStr = (rec.amount ?? "").replace(/[^0-9.-]/g, "");
        if (!date || amountStr === "") {
          bad++;
          continue;
        }
        rows.push({
          txn_date: date,
          description: rec.description ?? rec.memo ?? "",
          reference: rec.reference ?? rec.ref ?? null,
          amount_minor: toMinorUnits(parseFloat(amountStr), dec),
          running_balance_minor: rec.balance ? toMinorUnits(parseFloat(rec.balance.replace(/[^0-9.-]/g, "")), dec) : null,
          raw_line: Object.values(rec).join(","),
        });
      }
      setParsed(rows);
      setFileName(file.name);
      if (bad) message.warning(`${bad} row(s) skipped (missing date or amount)`);
    };
    reader.readAsText(file);
    return false; // prevent antd auto-upload
  }

  async function confirmImport() {
    if (!selectedId || !parsed.length) return;
    setBusy("import");
    const res = await importStatementAction(selectedId, fileName, parsed);
    setBusy(null);
    if (res.ok && res.data) {
      message.success(`Imported ${res.data.inserted} transaction(s); ${res.data.skipped} duplicate(s) skipped`);
      setImportOpen(false);
      setParsed([]);
      reload();
    } else {
      message.error(res.error ?? "Import failed");
    }
  }

  async function findMatches() {
    if (!selectedId) return;
    setBusy("match");
    const res = await generateSuggestionsAction(selectedId);
    setBusy(null);
    if (res.ok && res.data) {
      message.success(`${res.data.count} new match suggestion(s)`);
      setTab("reconcile");
      reload();
    } else {
      message.error(res.error ?? "Failed to find matches");
    }
  }

  async function approve(id: string) {
    setBusy(id);
    const res = await approveReconciliationAction(id);
    setBusy(null);
    if (res.ok) {
      message.success("Match approved");
      reload();
    } else message.error(res.error ?? "Failed");
  }
  async function reject(id: string) {
    setBusy(id);
    const res = await rejectReconciliationAction(id);
    setBusy(null);
    if (res.ok) reload();
    else message.error(res.error ?? "Failed");
  }

  const txnColumns: TableColumnsType<BankTransactionRow> = [
    { title: "Date", dataIndex: "txn_date", width: 120 },
    { title: "Description", dataIndex: "description" },
    { title: "Reference", dataIndex: "reference", width: 140, render: (r) => r ?? "—" },
    {
      title: "Amount",
      dataIndex: "amount_minor",
      width: 140,
      align: "right",
      render: (v: number) => <span style={{ color: v < 0 ? "#b91c1c" : "#15803d" }}>{money(v)}</span>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 120,
      render: (s: BankTxnStatus) => <Tag color={TXN_STATUS[s].color}>{TXN_STATUS[s].text}</Tag>,
    },
  ];

  const suggestionColumns: TableColumnsType<SuggestionView> = [
    { title: "Date", dataIndex: "txn_date", width: 110 },
    { title: "Bank description", dataIndex: "txn_description" },
    { title: "Amount", dataIndex: "amount_minor", width: 130, align: "right", render: (v: number) => money(v) },
    { title: "Payment", dataIndex: "payment_number", width: 130, render: (n) => n ?? "—" },
    {
      title: "Confidence",
      dataIndex: "confidence",
      width: 120,
      render: (c: number) => {
        const pct = Math.round(c * 100);
        const color = pct >= 90 ? "green" : pct >= 75 ? "gold" : "orange";
        return <Tag color={color}>{pct}%</Tag>;
      },
    },
    ...(canWrite
      ? [
          {
            title: "Action",
            key: "action",
            width: 170,
            render: (_: unknown, r: SuggestionView) => (
              <Space>
                <Button size="small" type="primary" loading={busy === r.id} onClick={() => approve(r.id)}>
                  Approve
                </Button>
                <Button size="small" loading={busy === r.id} onClick={() => reject(r.id)}>
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
              ? "Connect a ledger bank account before importing transactions."
              : "Create a Bank-type account in the Chart of Accounts first."
          }
          action={
            canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAcctOpen(true)} disabled={!glBankAccounts.length}>
              Add bank account
            </Button>
            ) : null
          }
        />
        <CreateAccountModal open={acctOpen} onCancel={() => setAcctOpen(false)} onOk={submitAccount} form={acctForm} glBankAccounts={glBankAccounts} currencies={currencies} />
      </>
    );
  }

  const unmatchedCount = txns.filter((t) => t.status === "unmatched").length;

  return (
    <div>
      <FilterBar
        resultCount={tab === "transactions" ? txns.length : suggestions.length}
        actions={
          canWrite ? (
            <Space wrap>
              {glBankAccounts.length > 0 && (
                <Button icon={<PlusOutlined />} onClick={() => setAcctOpen(true)}>
                  Add account
                </Button>
              )}
              {tab === "transactions" ? (
                <Button type="primary" icon={<InboxOutlined />} onClick={() => setImportOpen(true)}>
                  Import statement
                </Button>
              ) : (
                <Button type="primary" icon={<ThunderboltOutlined />} loading={busy === "match"} onClick={findMatches}>
                  Find matches
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
            options={bankAccounts.map((b) => ({
              value: b.id,
              label: `${b.bank_name || b.account_name} · ${b.account_code} (${b.currency_code})`,
            }))}
          />
          <Segmented
            value={tab}
            onChange={(v) => setTab(v as "transactions" | "reconcile")}
            options={[
              { label: `Transactions${unmatchedCount ? ` (${unmatchedCount} unmatched)` : ""}`, value: "transactions" },
              { label: `Reconcile${suggestions.length ? ` (${suggestions.length})` : ""}`, value: "reconcile" },
            ]}
          />
        </Space>
      </FilterBar>

      {tab === "transactions" ? (
        <DataTable
          rowKey="id"
          columns={txnColumns}
          dataSource={txns}
          pagination={{ pageSize: 25 }}
          sticky
          loading={loading}
          emptyTitle="No bank transactions"
          emptyDescription="Import a statement to start reviewing and matching transactions."
        />
      ) : (
        <DataTable
          rowKey="id"
          columns={suggestionColumns}
          dataSource={suggestions}
          pagination={{ pageSize: 25 }}
          sticky
          loading={loading}
          emptyTitle="No match suggestions"
          emptyDescription='Select "Find matches" to compare bank activity with recorded payments.'
        />
      )}

      {/* Import modal */}
      <Modal
        title="Import bank statement"
        open={importOpen}
        onOk={confirmImport}
        onCancel={() => { setImportOpen(false); setParsed([]); }}
        okText={parsed.length ? `Import ${parsed.length} rows` : "Import"}
        okButtonProps={{ disabled: !parsed.length, loading: busy === "import" }}
        cancelText="Cancel"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          Upload a comma-separated values file with columns: <code>date, description, amount, reference, balance</code>. Positive amounts are
          money in. Dates as YYYY-MM-DD or MM/DD/YYYY.
        </Typography.Paragraph>
        <Upload.Dragger accept=".csv" beforeUpload={handleFile} maxCount={1} showUploadList={{ showRemoveIcon: false }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Click or drag a comma-separated values file here</p>
        </Upload.Dragger>
        {parsed.length > 0 && (
          <Typography.Paragraph style={{ marginTop: 12 }}>
            Parsed <strong>{parsed.length}</strong> transactions from <strong>{fileName}</strong>.
          </Typography.Paragraph>
        )}
      </Modal>

      <CreateAccountModal open={acctOpen} onCancel={() => setAcctOpen(false)} onOk={submitAccount} form={acctForm} glBankAccounts={glBankAccounts} currencies={currencies} />
    </div>
  );
}

function CreateAccountModal({
  open, onCancel, onOk, form, glBankAccounts, currencies,
}: {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  form: ReturnType<typeof Form.useForm>[0];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
}) {
  return (
    <Modal title="Add bank account" open={open} onOk={onOk} onCancel={onCancel} okText="Create" cancelText="Cancel" destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="account_id" label="General Ledger bank account" rules={[{ required: true, message: "Select an account" }]}>
          <Select
            placeholder="Select a Bank-type account"
            options={glBankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
          />
        </Form.Item>
        <Form.Item name="bank_name" label="Bank name" rules={[{ required: true, message: "Enter the bank name" }]}>
          <Input placeholder="e.g. First National Bank" />
        </Form.Item>
        <Form.Item name="account_number_masked" label="Account number (masked)">
          <Input placeholder="e.g. ****1234" />
        </Form.Item>
        <Form.Item name="currency_code" label="Currency" rules={[{ required: true, message: "Select a currency" }]}>
          <Select options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
