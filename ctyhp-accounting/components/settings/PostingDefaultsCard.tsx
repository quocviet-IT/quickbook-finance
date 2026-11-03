"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Descriptions, Form, Select, Typography } from "antd";
import FormActions from "@/components/ui/FormActions";
import type { AccountRow } from "@/lib/db/types";
import {
  POSTING_DEFAULT_LABELS,
  POSTING_DEFAULT_RULES,
  type PostingDefaultKey,
  type PostingDefaults,
} from "@/lib/domain/posting-defaults";
import { savePostingDefaultsAction } from "@/app/(app)/settings/company/actions";

const KEYS: PostingDefaultKey[] = ["depositAccountId", "payFromAccountId", "incomeAccountId", "expenseAccountId"];

const accountLabel = (a: Pick<AccountRow, "account_code" | "name">) => `${a.account_code} — ${a.name}`;

/**
 * Where new documents land unless somebody chooses otherwise (3.01), as the
 * approved design's Company tab has them. Each default only fills a form:
 * a posted document keeps its own accounts, so changing one rewrites nothing.
 */
export default function PostingDefaultsCard({
  defaults,
  accounts,
  canEdit,
}: {
  defaults: PostingDefaults;
  accounts: AccountRow[];
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<PostingDefaults>();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const startEdit = () => {
    form.setFieldsValue(defaults);
    setEditing(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await savePostingDefaultsAction({
        depositAccountId: values.depositAccountId ?? null,
        payFromAccountId: values.payFromAccountId ?? null,
        incomeAccountId: values.incomeAccountId ?? null,
        expenseAccountId: values.expenseAccountId ?? null,
      });
      if (!res.ok) {
        message.error(res.error ?? "Failed to save the posting defaults");
        return;
      }
      message.success("Posting defaults saved");
      setEditing(false);
      // As the other settings screens do: the saved defaults are read again with the page.
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Posting defaults" extra={canEdit && !editing ? <Button onClick={startEdit}>Edit</Button> : null}>
      <Typography.Paragraph type="secondary">
        New documents start on these accounts. Every form still shows the account before anything is saved, and a
        document keeps whatever it was posted to, so changing a default never changes a figure already in the books.
      </Typography.Paragraph>
      {editing ? (
        <Form form={form} layout="vertical">
          {KEYS.map((key) => (
            <Form.Item key={key} name={key} label={POSTING_DEFAULT_LABELS[key].label} extra={POSTING_DEFAULT_LABELS[key].usedBy}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="No default"
                style={{ maxWidth: 420 }}
                options={accounts.filter(POSTING_DEFAULT_RULES[key]).map((a) => ({ value: a.id, label: accountLabel(a) }))}
              />
            </Form.Item>
          ))}
          <FormActions>
            <Button type="primary" loading={saving} onClick={submit}>
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </FormActions>
        </Form>
      ) : (
        <Descriptions layout="vertical" column={{ xs: 1, sm: 2 }} size="small" colon={false}>
          {KEYS.map((key) => {
            const account = defaults[key] ? byId.get(defaults[key]!) : undefined;
            const usable = account ? POSTING_DEFAULT_RULES[key](account) : false;
            return (
              <Descriptions.Item key={key} label={POSTING_DEFAULT_LABELS[key].label}>
                <span>
                  {account ? accountLabel(account) : <Typography.Text type="secondary">Not set</Typography.Text>}
                  {account && !usable ? (
                    <Typography.Text type="warning">{" "}(inactive, so not filled in)</Typography.Text>
                  ) : null}
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {POSTING_DEFAULT_LABELS[key].usedBy}
                  </Typography.Text>
                </span>
              </Descriptions.Item>
            );
          })}
        </Descriptions>
      )}
    </Card>
  );
}
