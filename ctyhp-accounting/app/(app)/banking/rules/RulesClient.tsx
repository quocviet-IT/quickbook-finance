"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AccountRow } from "@/lib/db/types";
import type { BankRule } from "@/lib/domain/bank-rules";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import RuleFormModal, { EMPTY_RULE, toRuleInput, type RuleFormValues } from "./RuleFormModal";
import { deleteBankRuleAction, reorderBankRulesAction, saveBankRuleAction } from "./actions";

export interface RuleListRow extends BankRule {
  accountLabel: string;
  /** False when the account is no longer one a rule may code to. */
  accountUsable: boolean;
  /** Waiting lines this rule matches on its own. */
  waiting: number;
}

const DIRECTION_LABEL = { in: "Money in", out: "Money out", any: "Either" } as const;
const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

function amountWindow(rule: BankRule): string {
  if (rule.minMinor === null && rule.maxMinor === null) return "Any amount";
  if (rule.minMinor !== null && rule.maxMinor !== null) return `${money(rule.minMinor)} – ${money(rule.maxMinor)}`;
  return rule.minMinor !== null ? `${money(rule.minMinor)} or more` : `Up to ${money(rule.maxMinor as number)}`;
}

const valuesOf = (rule: BankRule): RuleFormValues => ({
  matchKind: rule.matchKind,
  matchText: rule.matchText,
  direction: rule.direction,
  minAmount: rule.minMinor === null ? null : rule.minMinor / 100,
  maxAmount: rule.maxMinor === null ? null : rule.maxMinor / 100,
  accountId: rule.accountId,
  isActive: rule.isActive,
});

/**
 * Bank rules in the order they are tried. The first that matches a waiting
 * line suggests its account; history speaks only when none does.
 */
export default function RulesClient({
  rules,
  accounts,
  canWrite,
}: {
  rules: RuleListRow[];
  accounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RuleFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= rules.length) return;
    const ids = rules.map((rule) => rule.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(rules[index].id);
    const res = await reorderBankRulesAction(ids);
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the order");
      return;
    }
    router.refresh();
  }

  async function setActive(rule: RuleListRow, isActive: boolean) {
    setBusy(rule.id);
    const res = await saveBankRuleAction(rule.id, toRuleInput({ ...valuesOf(rule), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the rule");
      return;
    }
    router.refresh();
  }

  function remove(rule: RuleListRow) {
    modal.confirm({
      title: "Delete this rule?",
      content: `"${rule.matchText}" → ${rule.accountLabel}. Lines already coded stay as they are.`,
      okText: "Delete rule",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteBankRuleAction(rule.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not delete the rule");
          return;
        }
        message.success("Rule deleted");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RuleListRow> = [
    {
      title: "#",
      key: "order",
      width: COLUMN.ACTION,
      render: (_: unknown, _rule: RuleListRow, index: number) => index + 1,
    },
    {
      ...flexColumn<RuleListRow>({
        title: "Looks for",
        key: "match",
        render: (_: unknown, rule: RuleListRow) => (
          <Space size={6} wrap>
            <Typography.Text code>{rule.matchText}</Typography.Text>
            {rule.matchKind === "regex" ? <Tag>regular expression</Tag> : null}
          </Space>
        ),
      }),
    },
    { title: "Money", key: "direction", width: COLUMN.STATUS, render: (_: unknown, rule: RuleListRow) => DIRECTION_LABEL[rule.direction] },
    { title: "Amount", key: "amount", width: COLUMN.PICKER, render: (_: unknown, rule: RuleListRow) => amountWindow(rule) },
    {
      title: "Codes to",
      key: "account",
      width: COLUMN.PICKER,
      render: (_: unknown, rule: RuleListRow) =>
        rule.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: rule.accountLabel }}>{rule.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or not one a rule may code to. The rule suggests nothing until it is changed.">
            <Tag color="orange">{rule.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: COLUMN.STATUS,
      align: "right",
      render: (_: unknown, rule: RuleListRow) => rule.waiting,
    },
    {
      title: "On",
      key: "active",
      width: COLUMN.ACTION * 2,
      render: (_: unknown, rule: RuleListRow) => (
        <Switch
          size="small"
          checked={rule.isActive}
          disabled={!canWrite}
          loading={busy === rule.id}
          onChange={(checked) => void setActive(rule, checked)}
        />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: COLUMN.ACTION * 4,
            align: "right" as const,
            render: (_: unknown, rule: RuleListRow, index: number) => (
              <Space size={2}>
                <IconActionButton label="Move up" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => void move(index, -1)} />
                <IconActionButton
                  label="Move down"
                  icon={<ArrowDownOutlined />}
                  disabled={index === rules.length - 1}
                  onClick={() => void move(index, 1)}
                />
                <IconActionButton label="Edit rule" icon={<EditOutlined />} onClick={() => setEditing({ id: rule.id, values: valuesOf(rule) })} />
                <IconActionButton label="Delete rule" icon={<DeleteOutlined />} onClick={() => remove(rule)} />
              </Space>
            ),
          } as TableColumnsType<RuleListRow>[number],
        ]
      : []),
  ];

  return (
    <div>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ id: null, values: EMPTY_RULE })}>
            New rule
          </Button>
        </Space>
      ) : null}
      <DataTable<RuleListRow>
        rowKey="id"
        columns={columns}
        dataSource={rules}
        pagination={false}
        emptyTitle="No bank rules yet"
        emptyDescription="A rule says which account a bank line belongs to, by the words on it. Until there are rules, suggestions come from how lines were coded before."
      />
      <RuleFormModal
        open={editing !== null}
        ruleId={editing?.id ?? null}
        initial={editing?.values ?? EMPTY_RULE}
        accounts={accounts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}
