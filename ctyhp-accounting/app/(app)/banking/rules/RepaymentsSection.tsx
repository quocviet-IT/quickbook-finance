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
import type { RepaymentAccount } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import RepaymentFormModal, { EMPTY_CARD, toRepaymentInput, type RepaymentFormValues } from "./RepaymentFormModal";
import { deleteRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentListRow extends RepaymentAccount {
  accountLabel: string;
  /** False when the account is no longer an active posting account of the right type. */
  accountUsable: boolean;
  stats: RepaymentStats;
}

const valuesOf = (entry: RepaymentAccount): RepaymentFormValues => ({
  accountId: entry.accountId,
  matchWords: entry.matchWords,
  matchDigits: entry.matchDigits ?? "",
  isActive: entry.isActive,
});

/**
 * Cards and loans: which payments out of the bank repay a balance. A line that
 * carries an entry's words or last four is offered as a card payment before
 * any rule, because a payment to a card is never an expense.
 */
export default function RepaymentsSection({
  rows,
  cardAccounts,
  canWrite,
}: {
  rows: RepaymentListRow[];
  cardAccounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RepaymentFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const choosable = cardAccounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);

  async function setActive(row: RepaymentListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRepaymentAction(row.id, toRepaymentInput({ ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the card");
      return;
    }
    router.refresh();
  }

  function remove(row: RepaymentListRow) {
    modal.confirm({
      title: "Remove this card?",
      content: `${row.accountLabel}. Lines already posted stay as they are; new ones are no longer recognized as payments to it.`,
      okText: "Remove card",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRepaymentAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not remove the card");
          return;
        }
        message.success("Card removed");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RepaymentListRow> = [
    { title: "Kind", key: "kind", width: COLUMN.ACTION * 2, render: () => <Tag>Card</Tag> },
    {
      title: "Account",
      key: "account",
      width: COLUMN.PICKER + COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or no longer a Credit Card account. Nothing is recognized as a payment to it until it is changed.">
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
                <IconActionButton label="Edit card" icon={<EditOutlined />} onClick={() => setEditing({ id: row.id, values: valuesOf(row) })} />
                <IconActionButton label="Remove card" icon={<DeleteOutlined />} onClick={() => remove(row)} />
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
        A payment to a credit card repays its balance — the costs were the card&apos;s own charges, so the payment is
        never an expense. Add each card with the words your bank prints for its payments, or its last four digits, and
        such a line is offered as a card payment before any rule.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} disabled={cardAccounts.every((a) => taken.has(a.id))} onClick={() => setEditing({ id: null, values: EMPTY_CARD })}>
            Add card
          </Button>
          {cardAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add a Credit Card account in Chart of Accounts first.</Typography.Text>
          ) : cardAccounts.every((a) => taken.has(a.id)) ? (
            <Typography.Text type="secondary">
              Every Credit Card account is already here. Add another Credit Card account in Chart of Accounts to register it.
            </Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RepaymentListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No cards yet"
        emptyDescription="Until a card is added here, its payments are suggested by rules and history like any other line."
      />
      <RepaymentFormModal
        open={editing !== null}
        repaymentId={editing?.id ?? null}
        initial={editing?.values ?? EMPTY_CARD}
        accounts={choosable}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </section>
  );
}
