"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import type { BankStanding } from "@/lib/domain/bank-standing";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import { chosenBankId } from "@/lib/domain/reconcile-alerts-screen";
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
    void bankStandingAction(id).then((s) => {
      if (latestStanding.current !== standingTicket) return;
      setStanding(s.ok ? (s.data ?? null) : null);
    });
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

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  // Finished reading and none found: the card is the empty state. While a read
  // runs the table keeps its loading state, so the empty state never flashes.
  const isEmpty = Boolean(bank) && !loading && loadedFor === bankId && rows.length === 0;

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

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select
          style={{ width: 320 }}
          aria-label="Bank account"
          value={bankId}
          onChange={choose}
          options={banks.map((b) => ({ value: b.id, label: b.label }))}
        />
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
        {/* Every account's lines not yet reconciled, and bringing an account's history forward (2.03). */}
        <Link href={RECONCILE_HISTORY_PATH}>{RECONCILE_HISTORY}</Link>
      </Space>
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
        <StandingCard accountName={bank.name} standing={standing?.bankAccountId === bank.id ? standing : null} today={today} money={fmt} empty={isEmpty}>
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
          loading={loading}
          dataSource={rows}
          columns={[
            { title: "Ending date", dataIndex: "statement_ending_date" },
            { title: "Beginning", align: "right", render: (_, r) => fmt(r.beginning_balance_minor) },
            { title: "Statement ending", align: "right", render: (_, r) => fmt(r.statement_ending_balance_minor) },
            { title: "Statement", render: (_, r) => r.statement_ref ?? "—" },
            {
              title: "Status",
              render: (_, r) => (
                <Space size={4} wrap>
                  <Tag color={r.status === "completed" ? "green" : "blue"}>{r.status}</Tag>
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
