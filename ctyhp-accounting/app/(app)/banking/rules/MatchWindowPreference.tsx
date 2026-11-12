"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Select, Space, Typography } from "antd";
import {
  MATCH_WINDOW_CARD,
  MATCH_WINDOW_OPTIONS,
  matchWindowLabel,
} from "@/lib/domain/statement-match-window";
import { saveStatementMatchWindowAction } from "./actions";
import styles from "./pairs-preference.module.css";

/**
 * Statement matching (3.0.24, item E of the defect report of 11 Nov 2026):
 * the company's own window for pairing a statement line with an entry of the
 * same amount on the same bank account. Reconcile, Match again, Add missing
 * lines and a run of statement files all read the saved figure.
 */
export default function MatchWindowPreference({ initialDays, canWrite }: { initialDays: number; canWrite: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [days, setDays] = useState<number>(initialDays);
  const [saving, setSaving] = useState(false);
  const options = [...new Set([...MATCH_WINDOW_OPTIONS, initialDays])].sort((a, b) => a - b);

  async function save() {
    setSaving(true);
    try {
      const res = await saveStatementMatchWindowAction(days);
      if (!res.ok) {
        message.error(res.error ?? "Could not save the setting");
        return;
      }
      message.success(MATCH_WINDOW_CARD.saved);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.pairs} aria-labelledby="match-window-heading">
      <Typography.Text strong id="match-window-heading">
        {MATCH_WINDOW_CARD.heading}
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        {MATCH_WINDOW_CARD.lede}
      </Typography.Paragraph>
      {canWrite ? (
        <Space wrap align="end" size={16}>
          <div>
            <Typography.Text type="secondary" className={styles.label}>
              {MATCH_WINDOW_CARD.label}
            </Typography.Text>
            <Select
              aria-label={MATCH_WINDOW_CARD.label}
              className={styles.window}
              value={days}
              onChange={(value: number) => setDays(value)}
              options={options.map((value) => ({ value, label: matchWindowLabel(value) }))}
            />
          </div>
          <Button type="primary" loading={saving} disabled={days === initialDays} onClick={() => void save()}>
            Save
          </Button>
        </Space>
      ) : (
        <Typography.Text>
          {MATCH_WINDOW_CARD.label} {matchWindowLabel(initialDays).toLowerCase()}
        </Typography.Text>
      )}
    </section>
  );
}
