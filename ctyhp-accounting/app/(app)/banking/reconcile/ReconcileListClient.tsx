"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import StatusTag from "@/components/ui/StatusTag";
import FilterBar from "@/components/ui/FilterBar";
import { toMinor } from "@/lib/domain/money";
import { formatDate, formatMoney } from "@/lib/format";
import type { BankStanding } from "@/lib/domain/bank-standing";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import { chosenBankId, reconcileTableLoading, rowsForAccount } from "@/lib/domain/reconcile-alerts-screen";
import { EmptyState } from "@/components/ui/PageStates";
import TableEmpty from "@/components/ui/TableEmpty";
import { RECONCILE_HISTORY, RECONCILE_HISTORY_PATH } from "@/lib/domain/reconcile-history";
import { bankStandingAction, createReconciliationAction, listReconciliationsAction } from "./actions";
import StandingCard from "./StandingCard";
import StatementAlertsPanel from "./StatementAlertsPanel";
import type { StatementReconciliationRow } from "@/lib/db/types";

interface Bank {
  id: string;
  label: string;
  /** The ledger account's name, which the statement alerts call the account by. */
  name: string;
}
interface Props {
  canWrite: boolean;
  /** The company's today, in its own time zone: the standing's age is measured to it. */
  today: string;
  banks: Bank[];
  baseCurrency: string;
  baseDecimals: number;
}

export default function ReconcileListClient({ canWrite, today, banks, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  // The chosen account lives in the address (?account=<bank id>), so the
  // Exceptions report and the Balance Sheet can link straight to it. An id
  // that is not one of these accounts falls back to the first.
  const bankId = chosenBankId(banks, useSearchParams().get("account"));
  const bank = banks.find((b) => b.id === bankId);
  const [rows, setRows] = useState<StatementReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  // The account whose reconciliations were last read: the empty state waits for it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [standing, setStanding] = useState<BankStanding | null>(null);
  // The account whose standing read has settled, found or not: the empty state waits for it too.
  const [standingFor, setStandingFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  // Only the latest read may draw: switch accounts quickly and a slower,
  // earlier answer would otherwise list another account's reconciliations.
  const latestLoad = useRef(0);
  // The same guard for the standing card.
  const latestStanding = useRef(0);

  const load = async (id: string | undefined) => {
    if (!id) return;
    const ticket = ++latestLoad.current;
    const standingTicket = ++latestStanding.current;
    setLoading(true);
    // The card is read beside the list and fails quietly: without it the table still works.
    const settle = (found: BankStanding | null) => {
      if (latestStanding.current !== standingTicket) return;
      setStanding(found);
      setStandingFor(id);
    };
    void bankStandingAction(id).then(
      (s) => settle(s.ok ? (s.data ?? null) : null),
      () => settle(null),
    );
    const r = await listReconciliationsAction(id);
    if (latestLoad.current !== ticket) return;
    setLoading(false);
    if (r.ok && r.data) {
      setRows(r.data);
      setLoadedFor(id);
    } else message.error(r.error ?? "Failed to load");
  };

  const choose = (id: string) => {
    // history.replaceState, as Chart of Accounts does: Next.js carries it into
    // useSearchParams, where the account is read, without a server request.
    window.history.replaceState(null, "", reconcileHref(id));
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  // The card is a sentence, read beside the Balance Sheet's: money with its currency, as there.
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);

  // Finished reading and none found: the card is the empty state. While either
  // read runs the table keeps its loading state, so neither "No data" nor a
  // sentence without its counts flashes before the full empty state.
  const standingSettled = standingFor === bankId;
  const isEmpty = Boolean(bank) && !loading && loadedFor === bankId && rows.length === 0 && standingSettled;
  // Only this account's reconciliations, and loading until they are here.
  const shownRows = rowsForAccount(bankId, loadedFor, rows);
  const tableLoading = reconcileTableLoading({
    bankId,
    loading: loading || loadedFor !== bankId,
    rowCount: shownRows.length,
    standingSettled,
  });

  const submit = async () => {
    const v = await form.validateFields();
    const r = await createReconciliationAction({
      bank_account_id: bankId,
      statement_ending_date: v.ending_date.format("YYYY-MM-DD"),
      statement_ending_balance_minor: toMinor(v.ending_balance ?? 0, baseDecimals),
    });
    if (r.ok) {
      message.success("Reconciliation started");
      setOpen(false);
      form.resetFields();
      void load(bankId);
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  // A company with no bank account has nothing to reconcile, and an empty
  // account box over a spinning table said so badly: it spun for ever.
  if (banks.length === 0) {
    return (
      <EmptyState
        title="No bank account to reconcile yet"
        description={
          canWrite
            ? "Reconciling checks a bank account's books against its statements. Add the account under Bank Transactions, then reconcile it here."
            : "Reconciling checks a bank account's books against its statements. Once someone who keeps the books adds a bank account under Bank Transactions, it can be reconciled here."
        }
        action={
          <Button type={canWrite ? "primary" : "default"} href="/banking">
            Go to Bank Transactions
          </Button>
        }
      />
    );
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        ariaLabel="Bank account and reconciliation actions"
        actions={
          canWrite ? (
            <>
              <Button onClick={() => router.push(`/banking/reconcile/from-files?account=${bankId}`)} disabled={!bankId}>
                From statement files
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)} disabled={!bankId}>
                New reconciliation
              </Button>
            </>
          ) : undefined
        }
      >
        <Select
          style={{ width: 320 }}
          aria-label="Bank account"
          value={bankId}
          onChange={choose}
          options={banks.map((b) => ({ value: b.id, label: b.label }))}
        />
        {/* Every account's lines not yet reconciled, and bringing an account's history forward (2.03). */}
        <Link href={RECONCILE_HISTORY_PATH}>{RECONCILE_HISTORY}</Link>
      </FilterBar>
      {bank ? (
        <StatementAlertsPanel
          bankAccountId={bank.id}
          accountName={bank.name}
          canWrite={canWrite}
          baseCurrency={baseCurrency}
          baseDecimals={baseDecimals}
          onRemoved={() => void load(bank.id)}
        />
      ) : null}
      {bank ? (
        <StandingCard accountName={bank.name} standing={standing?.bankAccountId === bank.id ? standing : null} today={today} money={money} empty={isEmpty}>
          {canWrite && (
            <Button type="primary" onClick={() => setOpen(true)} disabled={!bankId}>
              New reconciliation
            </Button>
          )}
          {canWrite && (
            <Button onClick={() => router.push(`/banking/reconcile/from-files?account=${bankId}`)} disabled={!bankId}>
              From statement files
            </Button>
          )}
        </StandingCard>
      ) : null}
      {isEmpty ? null : (
        <Table<StatementReconciliationRow>
          rowKey="id"
          loading={tableLoading}
          dataSource={[...shownRows]}
          locale={{ emptyText: <TableEmpty loading={tableLoading} title="No reconciliations yet" /> }}
          columns={[
            { title: "Ending date", dataIndex: "statement_ending_date", render: (value: string) => formatDate(value) },
            { title: "Beginning", align: "right", render: (_, r) => money(r.beginning_balance_minor) },
            { title: "Statement ending", align: "right", render: (_, r) => money(r.statement_ending_balance_minor) },
            { title: "Statement", render: (_, r) => r.statement_ref ?? "—" },
            {
              title: "Status",
              render: (_, r) => (
                <Space size={4} wrap>
                  <StatusTag status={r.status} />
                  {r.brought_forward ? (
                    <Tag color="purple" title={r.note ?? undefined}>
                      Brought forward
                    </Tag>
                  ) : null}
                </Space>
              ),
            },
            { title: "", render: (_, r) => <Link href={`/banking/reconcile/${r.id}`}>Open</Link> },
          ]}
        />
      )}
      <Modal open={open} title="New reconciliation" onCancel={() => setOpen(false)} onOk={submit} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="ending_date" label="Statement ending date" rules={[{ required: true }]}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="ending_balance" label="Statement ending balance" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} precision={baseDecimals} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
