"use client";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import StatusTag from "@/components/ui/StatusTag";
import FilterBar from "@/components/ui/FilterBar";
import { toMinor } from "@/lib/domain/money";
import { BALANCE_WORDS, cardStanding, shown, stored, type BalanceSide } from "@/lib/domain/card-account";
import { formatDate, formatMoney } from "@/lib/format";
import type { BankStanding } from "@/lib/domain/bank-standing";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import { chosenBankId, reconcileTableLoading, rowsForAccount } from "@/lib/domain/reconcile-alerts-screen";
import { flexColumn } from "@/components/ui/columns";
import { EmptyState } from "@/components/ui/PageStates";
import TableEmpty from "@/components/ui/TableEmpty";
import DataTable from "@/components/ui/DataTable";
import { COLUMN } from "@/lib/design/table-metrics";
import { RECONCILE_HISTORY, RECONCILE_HISTORY_PATH } from "@/lib/domain/reconcile-history";
import { createReconciliationAction, reconcileAccountAction } from "./actions";
import type { ReconcileAccountView } from "./account-view";
import StandingCard from "./StandingCard";
import StatementAlertsPanel from "./StatementAlertsPanel";
import type { StatementReconciliationRow } from "@/lib/db/types";

/**
 * Ending date, the two balances, Status, and the Open and Report links.
 * Statement (the bank's reference) takes what is left, at least
 * COLUMN.TEXT_MIN. Status holds up to three tags (the state, Brought forward,
 * Adjusted), so it gets two tokens' worth rather than wrapping every row.
 */
export const RECONCILE_LIST_FIXED_WIDTHS = [
  COLUMN.DATE,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.STATUS * 2,
  COLUMN.ACTION * 3,
] as const;

interface Bank {
  id: string;
  label: string;
  /** The ledger account's name, which the statement alerts call the account by. */
  name: string;
  /** A credit card (2.45) is shown as its statement prints it: what is owed. */
  side: BalanceSide;
}
interface Props {
  canWrite: boolean;
  /** The company's today, in its own time zone: the standing's age is measured to it. */
  today: string;
  banks: Bank[];
  baseCurrency: string;
  baseDecimals: number;
  /** What the page already read for the account it opens on (2.91). */
  opening: ReconcileAccountView | null;
}

export default function ReconcileListClient({ canWrite, today, banks, baseCurrency, baseDecimals, opening }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  // The chosen account lives in the address (?account=<bank id>), so the
  // Exceptions report and the Balance Sheet can link straight to it. An id
  // that is not one of these accounts falls back to the first.
  const bankId = chosenBankId(banks, useSearchParams().get("account"));
  const bank = banks.find((b) => b.id === bankId);
  // What the page read for the account it opened on (2.91), so the first paint
  // has it. Taken only for that account, and only when its list was read.
  const [seed] = useState(() =>
    opening && opening.bankAccountId === bankId && opening.reconciliations.ok ? opening : null,
  );
  const [rows, setRows] = useState<StatementReconciliationRow[]>(() => seed?.reconciliations.data ?? []);
  const [loading, setLoading] = useState(false);
  // The account whose reconciliations were last read: the empty state waits for it.
  const [loadedFor, setLoadedFor] = useState<string | null>(() => seed?.bankAccountId ?? null);
  const [standing, setStanding] = useState<BankStanding | null>(() => seed?.standing.data ?? null);
  // The account whose standing read has settled, found or not: the empty state waits for it too.
  const [standingFor, setStandingFor] = useState<string | null>(() => seed?.bankAccountId ?? null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  // Only the latest read may draw: switch accounts quickly and a slower,
  // earlier answer would otherwise list another account's reconciliations.
  const latestLoad = useRef(0);
  // The account the page already read; cleared on first use, so a switch reads.
  const openedOn = useRef(seed ? bankId : undefined);

  const load = async (id: string | undefined) => {
    if (!id) return;
    const ticket = ++latestLoad.current;
    setLoading(true);
    // The list and the standing card in one request (2.91).
    const r = await reconcileAccountAction(id);
    if (latestLoad.current !== ticket) return;
    setLoading(false);
    const view = r.ok ? r.data : undefined;
    // The card fails quietly: without it the table still works.
    setStanding(view?.standing.ok ? (view.standing.data ?? null) : null);
    setStandingFor(id);
    if (view?.reconciliations.ok && view.reconciliations.data) {
      setRows(view.reconciliations.data);
      setLoadedFor(id);
    } else message.error(view?.reconciliations.error ?? r.error ?? "Failed to load");
  };

  const choose = (id: string) => {
    // history.replaceState, as Chart of Accounts does: Next.js carries it into
    // useSearchParams, where the account is read, without a server request.
    window.history.replaceState(null, "", reconcileHref(id));
  };
  // A layout effect, so this read is first in Next's queue of Server Actions.
  // StatementAlertsPanel below asks from a passive effect, and every layout
  // effect runs before any passive one, a child's included. Sent from a
  // useEffect, the list waited behind the alerts' whole-ledger read.
  useLayoutEffect(() => {
    const already = openedOn.current !== undefined && openedOn.current === bankId;
    openedOn.current = undefined;
    if (already) return;
    void load(bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  // The card is a sentence, read beside the Balance Sheet's: money with its currency, as there.
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);
  // A credit card's figures as its statement prints them (2.45).
  const side: BalanceSide = bank?.side ?? "bank";
  const words = BALANCE_WORDS[side];

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
      // Typed as the statement prints it; a card's balance owed is kept negative.
      statement_ending_balance_minor: stored(toMinor(v.ending_balance ?? 0, baseDecimals), side),
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
      {bank && words.note ? <Typography.Text type="secondary">{words.note}</Typography.Text> : null}
      {bank ? (
        <StandingCard
          accountName={bank.name}
          standing={standing?.bankAccountId === bank.id ? cardStanding(standing, side) : null}
          today={today}
          money={money}
          empty={isEmpty}
        >
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
        <DataTable<StatementReconciliationRow>
          rowKey="id"
          loading={tableLoading}
          rows={[...shownRows]}
          locale={{ emptyText: <TableEmpty loading={tableLoading} title="No reconciliations yet" /> }}
          columns={[
            { title: "Ending date", dataIndex: "statement_ending_date", width: RECONCILE_LIST_FIXED_WIDTHS[0], render: (value: string) => formatDate(value) },
            { title: words.beginning, align: "right", width: RECONCILE_LIST_FIXED_WIDTHS[1], render: (_, r) => money(shown(Number(r.beginning_balance_minor), side)) },
            { title: words.ending, align: "right", width: RECONCILE_LIST_FIXED_WIDTHS[2], render: (_, r) => money(shown(Number(r.statement_ending_balance_minor), side)) },
            flexColumn<StatementReconciliationRow>({ title: "Statement", render: (_, r) => r.statement_ref ?? "—" }),
            {
              title: "Status",
              // Not a bare StatusTag: Brought forward and Adjusted can sit beside it.
              width: RECONCILE_LIST_FIXED_WIDTHS[3],
              render: (_, r) => (
                <Space size={4} wrap>
                  <StatusTag status={r.status} />
                  {r.brought_forward ? (
                    <Tag color="purple" title={r.note ?? undefined}>
                      Brought forward
                    </Tag>
                  ) : null}
                  {r.adjustment_entry_id ? (
                    <Tag color="gold" title={r.adjustment_reason ?? undefined}>
                      Adjusted
                    </Tag>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "",
              width: RECONCILE_LIST_FIXED_WIDTHS[4],
              render: (_, r) => (
                <Space size={12}>
                  <Link href={`/banking/reconcile/${r.id}`}>Open</Link>
                  <Link href={`/banking/reconcile/${r.id}/report`}>Report</Link>
                </Space>
              ),
            },
          ]}
        />
      )}
      <Modal open={open} title="New reconciliation" onCancel={() => setOpen(false)} onOk={submit} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="ending_date" label="Statement ending date" rules={[{ required: true }]}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="ending_balance" label={words.endingInput} rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} precision={baseDecimals} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
