"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import type { RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { formatMoney } from "@/lib/format";
import type { RepaymentStats } from "@/lib/services/repayments";
import RepaymentFormModal, { EMPTY_REPAYMENT, toRepaymentInput, type RepaymentFormValues } from "./RepaymentFormModal";
import { deleteRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentListRow extends RepaymentAccount {
  accountLabel: string;
  /** "8100 — Interest Expense"; null for a card. */
  interestLabel: string | null;
  /** False when an account is no longer an active posting account of the right type. */
  accountUsable: boolean;
  stats: RepaymentStats;
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

const valuesOf = (entry: RepaymentAccount): RepaymentFormValues => ({
  accountId: entry.accountId,
  matchWords: entry.matchWords,
  matchDigits: entry.matchDigits ?? "",
  isActive: entry.isActive,
  interestAccountId: entry.interestAccountId,
  interestMethod: entry.interestMethod ?? "rate",
  annualRate: entry.annualRate,
  fixedInterest: entry.fixedInterestMinor === null ? null : entry.fixedInterestMinor / 100,
});

function interestText(row: RepaymentListRow): string {
  if (row.kind === "card") return "—";
  const to = row.interestLabel ?? "an account not found";
  if (row.interestMethod === "rate") return `${(row.annualRate ?? 0).toFixed(3)}% a year → ${to}`;
  if (row.interestMethod === "fixed") return `${money(row.fixedInterestMinor ?? 0)} each payment → ${to}`;
  return `Typed each time → ${to}`;
}

/**
 * Cards and loans: which payments out of the bank repay a balance. A line that
 * carries an entry's words or last four is offered as a card or loan payment
 * before any rule: paying a card is never an expense, and of a loan payment
 * only the interest is.
 */
export default function RepaymentsSection({
  rows,
  cardAccounts,
  loanAccounts,
  interestAccounts,
  suggestedInterestId,
  canWrite,
}: {
  rows: RepaymentListRow[];
  cardAccounts: AccountRow[];
  loanAccounts: AccountRow[];
  interestAccounts: AccountRow[];
  suggestedInterestId: string | null;
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ kind: RepaymentKind; id: string | null; values: RepaymentFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const free = (accounts: AccountRow[]) => accounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);
  const allCardsTaken = cardAccounts.every((a) => taken.has(a.id));
  const allLoansTaken = loanAccounts.every((a) => taken.has(a.id));

  async function setActive(row: RepaymentListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRepaymentAction(row.id, toRepaymentInput(row.kind, { ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? `Could not change the ${row.kind}`);
      return;
    }
    router.refresh();
  }

  function remove(row: RepaymentListRow) {
    modal.confirm({
      title: `Remove this ${row.kind}?`,
      content: `${row.accountLabel}. Lines already posted stay as they are; new ones are no longer recognized as payments to it.`,
      okText: `Remove ${row.kind}`,
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRepaymentAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? `Could not remove the ${row.kind}`);
          return;
        }
        message.success(`${row.kind === "card" ? "Card" : "Loan"} removed`);
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RepaymentListRow> = [
    { title: "Kind", key: "kind", width: COLUMN.ACTION * 2, render: (_: unknown, row: RepaymentListRow) => <Tag>{row.kind === "card" ? "Card" : "Loan"}</Tag> },
    {
      title: "Account",
      key: "account",
      width: COLUMN.PICKER + COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="An account here is inactive, not a posting account, or no longer the right type: a card repays a Credit Card account; a loan repays a liability, with interest to an expense. Nothing is recognized as a payment to it until it is changed.">
            <Tag color="orange">{row.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      ...flexColumn<RepaymentListRow>({
        title: "Matches on",
        key: "match",
        render: (_: unknown, row: RepaymentListRow) => (
          <Space size={6} wrap>
            {row.matchWords ? <Typography.Text code>{row.matchWords}</Typography.Text> : null}
            {row.matchDigits ? <Typography.Text code>••{row.matchDigits}</Typography.Text> : null}
          </Space>
        ),
      }),
    },
    {
      title: "Interest",
      key: "interest",
      width: COLUMN.RICH_MIN,
      render: (_: unknown, row: RepaymentListRow) => (
        <Typography.Text type={row.kind === "card" ? "secondary" : undefined} ellipsis={{ tooltip: interestText(row) }}>
          {interestText(row)}
        </Typography.Text>
      ),
    },
    {
      title: "Past payments caught",
      key: "past",
      width: COLUMN.PICKER,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => (row.stats.past === 0 ? "—" : `${row.stats.caught} of ${row.stats.past}`),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: COLUMN.STATUS,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => row.stats.waiting,
    },
    {
      title: "On",
      key: "active",
      width: COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) => (
        <Switch size="small" checked={row.isActive} disabled={!canWrite} loading={busy === row.id} onChange={(checked) => void setActive(row, checked)} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
            render: (_: unknown, row: RepaymentListRow) => (
              <Space size={2}>
                <IconActionButton label={`Edit ${row.kind}`} icon={<EditOutlined />} onClick={() => setEditing({ kind: row.kind, id: row.id, values: valuesOf(row) })} />
                <IconActionButton label={`Remove ${row.kind}`} icon={<DeleteOutlined />} onClick={() => remove(row)} />
              </Space>
            ),
          } as TableColumnsType<RepaymentListRow>[number],
        ]
      : []),
  ];

  return (
    <section className={styles.section} aria-labelledby="repayments-heading">
      <Typography.Text strong id="repayments-heading">
        Cards and loans
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        A payment to a credit card repays its balance — the costs were the card&apos;s own charges — and a loan instalment is
        principal plus interest, of which only the interest is an expense. Add each card or loan with the words your bank
        prints for its payments, or its last four digits, and such a line is offered as a card or loan payment before any rule.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button icon={<PlusOutlined />} disabled={allCardsTaken} onClick={() => setEditing({ kind: "card", id: null, values: EMPTY_REPAYMENT })}>
            Add card
          </Button>
          <Button
            icon={<PlusOutlined />}
            disabled={allLoansTaken || interestAccounts.length === 0}
            onClick={() => setEditing({ kind: "loan", id: null, values: { ...EMPTY_REPAYMENT, interestAccountId: suggestedInterestId } })}
          >
            Add loan
          </Button>
          {cardAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add a Credit Card account in Chart of Accounts to register a card.</Typography.Text>
          ) : allCardsTaken ? (
            <Typography.Text type="secondary">Every Credit Card account is already here.</Typography.Text>
          ) : null}
          {loanAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add a liability account in Chart of Accounts to register a loan.</Typography.Text>
          ) : allLoansTaken ? (
            <Typography.Text type="secondary">Every liability account is already here.</Typography.Text>
          ) : null}
          {interestAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add an Interest Expense account in Chart of Accounts to register a loan.</Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RepaymentListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No cards or loans yet"
        emptyDescription="Until a card or loan is added here, its payments are suggested by rules and history like any other line."
      />
      {editing ? (
        <RepaymentFormModal
          key={`${editing.kind}-${editing.id ?? "new"}`}
          open
          kind={editing.kind}
          repaymentId={editing.id}
          initial={editing.values}
          accounts={free(editing.kind === "card" ? cardAccounts : loanAccounts)}
          interestAccounts={interestAccounts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
