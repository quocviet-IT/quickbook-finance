"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { searchAccounts } from "@/lib/domain/account-search";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/domain/accounts";
import type { BankRuleInput } from "@/lib/domain/bank-rules";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import type { RulePreview } from "@/lib/services/coding";
import { previewBankRuleAction, saveBankRuleAction } from "./actions";

export interface RuleFormValues {
  matchKind: "words" | "regex";
  matchText: string;
  direction: "in" | "out" | "any";
  minAmount: number | null;
  maxAmount: number | null;
  accountId: string | null;
  isActive: boolean;
}

export const EMPTY_RULE: RuleFormValues = {
  matchKind: "words",
  matchText: "",
  direction: "any",
  minAmount: null,
  maxAmount: null,
  accountId: null,
  isActive: true,
};

const toMinor = (dollars: number | null | undefined) =>
  dollars === null || dollars === undefined ? null : Math.round(dollars * 100);

export function toRuleInput(values: RuleFormValues): BankRuleInput {
  return {
    matchKind: values.matchKind,
    matchText: (values.matchText ?? "").trim(),
    direction: values.direction,
    minMinor: toMinor(values.minAmount),
    maxMinor: toMinor(values.maxAmount),
    accountId: values.accountId ?? "",
    isActive: values.isActive,
  };
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

/**
 * Add or change a bank rule, with the waiting lines it would match shown as
 * it is written — so "fee" catching a $5,000 wire is seen before it is saved.
 */
export default function RuleFormModal({
  open,
  ruleId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  ruleId: string | null;
  initial: RuleFormValues;
  /** Only accounts a rule may code to. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RuleFormValues>();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const watched = Form.useWatch([], form) as RuleFormValues | undefined;

  // What the preview depends on, as one string: a new form object on a render
  // that changed nothing must not ask the server again.
  const previewKey = useMemo(() => {
    if (!watched) return "";
    const { matchKind, matchText, direction, minMinor, maxMinor } = toRuleInput({ ...EMPTY_RULE, ...watched });
    return matchText ? JSON.stringify({ matchKind, matchText, direction, minMinor, maxMinor }) : "";
  }, [watched]);

  useEffect(() => {
    if (!open || !previewKey) return;
    const timer = setTimeout(() => {
      void previewBankRuleAction(JSON.parse(previewKey)).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, previewKey]);

  const options = useMemo(
    () =>
      searchAccounts(
        accounts.map((account) => ({
          id: account.id,
          account_code: account.account_code,
          name: account.name,
          account_type: account.account_type as AccountType,
        })),
        query,
      ).map((hit) => ({
        value: hit.account.id,
        label: `${hit.account.account_code} — ${hit.account.name}`,
        type: hit.account.account_type,
      })),
    [accounts, query],
  );

  function close() {
    setPreview(null);
    setQuery("");
    onClose();
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveBankRuleAction(ruleId, toRuleInput({ ...EMPTY_RULE, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the rule");
      return;
    }
    message.success(ruleId ? "Rule saved" : "Rule created");
    setPreview(null);
    setQuery("");
    onSaved();
  }

  return (
    <Modal
      open={open}
      title={ruleId ? "Edit bank rule" : "New bank rule"}
      okText={ruleId ? "Save rule" : "Create rule"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial}>
        <Form.Item label="Looks for" required>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="matchText"
              noStyle
              rules={[
                { required: true, whitespace: true, message: "Say what the rule looks for" },
                { max: 200, message: "A rule looks for at most 200 characters" },
              ]}
            >
              <Input placeholder="gusto, metro realty, wire fee…" />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="matchKind" label="Match">
          <Radio.Group
            optionType="button"
            options={[
              { value: "words", label: "These words" },
              { value: "regex", label: "Regular expression" },
            ]}
          />
        </Form.Item>
        <Form.Item name="direction" label="Money">
          <Radio.Group
            optionType="button"
            options={[
              { value: "out", label: "Money out" },
              { value: "in", label: "Money in" },
              { value: "any", label: "Either" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Amount (optional)" extra="Leave both blank for any amount. Both ends are included.">
          <Space>
            <Form.Item name="minAmount" noStyle>
              <InputNumber min={0} precision={2} prefix="$" placeholder="From" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="maxAmount" noStyle>
              <InputNumber min={0} precision={2} prefix="$" placeholder="To" style={{ width: 160 }} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="accountId" label="Codes to" rules={[{ required: true, message: "Choose the account the rule codes to" }]}>
          <Select
            showSearch
            placeholder="Search accounts…"
            filterOption={false}
            searchValue={query}
            onSearch={setQuery}
            options={options}
            optionRender={(option) => (
              <Space direction="vertical" size={0}>
                <span>{option.data.label}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ACCOUNT_TYPE_LABEL[option.data.type as AccountType]}
                </Typography.Text>
              </Space>
            )}
          />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview ? (
        <div>
          <Typography.Text strong>
            {preview.count === 0
              ? "Matches no line waiting to be coded"
              : `Matches ${preview.count} line${preview.count === 1 ? "" : "s"} waiting to be coded`}
          </Typography.Text>
          {preview.examples.map((example) => (
            <div key={example.id}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {example.txnDate} · {example.description} · {money(example.amountMinor)}
              </Typography.Text>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
