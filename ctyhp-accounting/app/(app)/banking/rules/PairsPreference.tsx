"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Select, Space, Typography } from "antd";
import { PAIR_WINDOW_OPTIONS } from "@/lib/domain/bank-pairs";
import type { BankingPreference } from "@/lib/services/banking-preference";
import { saveBankingPreferenceAction } from "./actions";
import styles from "./pairs-preference.module.css";

const windowLabel = (days: number) => (days === 0 ? "Same day" : days === 1 ? "1 day" : `${days} days`);

/**
 * Where funding pairs post, and how far apart a pair may be. The account is
 * suggested from its name until someone saves a choice; with none chosen, no
 * funding pair is offered at all.
 */
export default function PairsPreference({
  initial,
  suggestedFundingId,
  accounts,
  canWrite,
}: {
  initial: BankingPreference;
  suggestedFundingId: string | null;
  accounts: { id: string; label: string }[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [fundingAccountId, setFundingAccountId] = useState<string | null>(
    initial.saved ? initial.fundingAccountId : suggestedFundingId,
  );
  const [pairWindowDays, setPairWindowDays] = useState<number>(initial.pairWindowDays);
  const [saving, setSaving] = useState(false);
  const unsavedSuggestion = !initial.saved && suggestedFundingId !== null && fundingAccountId === suggestedFundingId;
  const labelOf = (id: string | null) => accounts.find((a) => a.id === id)?.label ?? "Not chosen";

  async function save() {
    setSaving(true);
    const res = await saveBankingPreferenceAction({ fundingAccountId, pairWindowDays });
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the setting");
      return;
    }
    message.success("Pairs setting saved");
    router.refresh();
  }

  return (
    <section className={styles.pairs} aria-labelledby="pairs-heading">
      <Typography.Text strong id="pairs-heading">
        Pairs
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        A transfer between your own bank accounts, and money in and out of the same amount on one account within a few
        days, are offered as pairs on Review import. Funding pairs are never ticked for you.
      </Typography.Paragraph>
      {canWrite ? (
        <Space wrap align="end" size={16}>
          <div>
            <Typography.Text type="secondary" className={styles.label}>
              Funding pairs post to
            </Typography.Text>
            <Select
              aria-label="Funding pairs post to"
              className={styles.account}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Choose a liability account"
              value={fundingAccountId ?? undefined}
              onChange={(value: string | undefined) => setFundingAccountId(value ?? null)}
              options={accounts.map((a) => ({ value: a.id, label: a.label }))}
            />
          </div>
          <div>
            <Typography.Text type="secondary" className={styles.label}>
              Pair within
            </Typography.Text>
            <Select
              aria-label="Pair within"
              className={styles.window}
              value={pairWindowDays}
              onChange={(value: number) => setPairWindowDays(value)}
              options={PAIR_WINDOW_OPTIONS.map((days) => ({ value: days, label: windowLabel(days) }))}
            />
          </div>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </Space>
      ) : (
        <Typography.Text>
          Funding pairs post to {labelOf(initial.fundingAccountId)} · pairs within {windowLabel(initial.pairWindowDays)}
        </Typography.Text>
      )}
      {canWrite && unsavedSuggestion ? (
        <Typography.Text type="secondary" className={styles.hint}>
          Suggested from the account name — not saved yet.
        </Typography.Text>
      ) : null}
      {canWrite && !fundingAccountId ? (
        <Typography.Text type="secondary" className={styles.hint}>
          With no account chosen, funding pairs are not offered; transfers still are.
        </Typography.Text>
      ) : null}
    </section>
  );
}
