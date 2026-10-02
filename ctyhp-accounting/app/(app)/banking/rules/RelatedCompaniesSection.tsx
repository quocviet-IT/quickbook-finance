"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { balanceWords, type RelatedCompany } from "@/lib/domain/related-companies";
import { formatMoney } from "@/lib/format";
import RelatedCompanyFormModal, { EMPTY_RELATED, toRelatedInput, type RelatedFormValues } from "./RelatedCompanyFormModal";
import { deleteRelatedCompanyAction, saveRelatedCompanyAction } from "./actions";
import { RELATED_COLUMN_WIDTH } from "./related-columns";
import styles from "./repayments.module.css";

export interface RelatedListRow extends RelatedCompany {
  accountLabel: string;
  /** False when the account is no longer an active posting current asset or liability. */
  accountUsable: boolean;
  /** Waiting lines its words name. */
  waiting: number;
  /** Debit less credit on its account today, in minor units: above zero, it owes us. */
  balanceMinor: number;
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

const valuesOf = (row: RelatedCompany): RelatedFormValues => ({
  name: row.name,
  matchWords: row.matchWords,
  accountId: row.accountId,
  isActive: row.isActive,
});

/**
 * Related companies: other companies the same owners run. Money to or from
 * one is a loan between the two, never income or a cost; a line naming one,
 * in or out, is offered to its account before any rule. Its own books are not
 * written here.
 */
export default function RelatedCompaniesSection({
  rows,
  accounts,
  canWrite,
}: {
  rows: RelatedListRow[];
  /** Current asset and liability accounts a related company may use: not in Cards and loans. */
  accounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RelatedFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const free = accounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);
  const allTaken = accounts.every((account) => taken.has(account.id));

  async function setActive(row: RelatedListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRelatedCompanyAction(row.id, toRelatedInput({ ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the related company");
      return;
    }
    router.refresh();
  }

  function remove(row: RelatedListRow) {
    modal.confirm({
      title: "Remove this related company?",
      content: `${row.name}. Lines already posted stay as they are; new ones naming it are no longer offered to ${row.accountLabel}.`,
      okText: "Remove related company",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRelatedCompanyAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not remove the related company");
          return;
        }
        message.success("Related company removed");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RelatedListRow> = [
    {
      title: "Company",
      key: "name",
      width: RELATED_COLUMN_WIDTH.name,
      render: (_: unknown, row: RelatedListRow) => <Typography.Text ellipsis={{ tooltip: row.name }}>{row.name}</Typography.Text>,
    },
    {
      ...flexColumn<RelatedListRow>({
        title: "Matches on",
        key: "match",
        render: (_: unknown, row: RelatedListRow) => <Typography.Text code>{row.matchWords}</Typography.Text>,
      }),
    },
    {
      title: "Account",
      key: "account",
      width: RELATED_COLUMN_WIDTH.account,
      render: (_: unknown, row: RelatedListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or no longer a current asset or liability. Nothing is offered to it for this company until it is changed.">
            <Tag color="orange">{row.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      title: "Balance today",
      key: "balance",
      width: RELATED_COLUMN_WIDTH.balance,
      align: "right",
      render: (_: unknown, row: RelatedListRow) => (
        <Typography.Text type={row.balanceMinor === 0 ? "secondary" : undefined}>{balanceWords(row.balanceMinor, money)}</Typography.Text>
      ),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: RELATED_COLUMN_WIDTH.waiting,
      align: "right",
      render: (_: unknown, row: RelatedListRow) => row.waiting,
    },
    {
      title: "On",
      key: "active",
      width: RELATED_COLUMN_WIDTH.active,
      render: (_: unknown, row: RelatedListRow) => (
        <Switch size="small" checked={row.isActive} disabled={!canWrite} loading={busy === row.id} onChange={(checked) => void setActive(row, checked)} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: RELATED_COLUMN_WIDTH.actions,
            align: "right" as const,
            render: (_: unknown, row: RelatedListRow) => (
              <Space size={2}>
                <IconActionButton label="Edit related company" icon={<EditOutlined />} onClick={() => setEditing({ id: row.id, values: valuesOf(row) })} />
                <IconActionButton label="Remove related company" icon={<DeleteOutlined />} onClick={() => remove(row)} />
              </Space>
            ),
          } as TableColumnsType<RelatedListRow>[number],
        ]
      : []),
  ];

  return (
    <section className={styles.section} aria-labelledby="related-heading">
      <Typography.Text strong id="related-heading">
        Related companies
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        Money sent to or received from another company the same owners run is a loan between the two — never income or a
        cost. Add each one with the words your bank prints for it and the one account that carries what it owes you or you
        owe it, and a line naming it, in or out, is offered to that account before any rule. The other company&apos;s books are
        not written here: record its side there.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button icon={<PlusOutlined />} disabled={allTaken} onClick={() => setEditing({ id: null, values: EMPTY_RELATED })}>
            Add related company
          </Button>
          {accounts.length === 0 ? (
            <Typography.Text type="secondary">
              Add a current asset or liability account in Chart of Accounts, such as Due from/to Example Affiliate, to register a
              related company.
            </Typography.Text>
          ) : allTaken ? (
            <Typography.Text type="secondary">Every current asset and liability account that can take one already has a related company.</Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RelatedListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No related companies yet"
        emptyDescription="Until a company is added here, a line naming it is suggested by rules and history like any other line — which can make it income or a cost."
      />
      {editing ? (
        <RelatedCompanyFormModal
          key={editing.id ?? "new"}
          open
          relatedId={editing.id}
          initial={editing.values}
          accounts={free}
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
