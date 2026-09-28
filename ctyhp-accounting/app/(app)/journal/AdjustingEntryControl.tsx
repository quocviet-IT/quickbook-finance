"use client";
import { useState } from "react";
import { App, Checkbox, Input, Space } from "antd";
import { ADJUSTING_NOTE_MAX, type ClosedPeriodAsk } from "@/lib/domain/adjusting-entries";
import type { JournalEntrySummary } from "@/lib/services/journal";
import { markAdjustingAction, unmarkAdjustingAction } from "./actions";

/**
 * "Adjusting entry" and "Why it was adjusted", on an opened journal entry —
 * where the client's prototype puts them, on the entry card beside Edit.
 *
 * Ticking asks the database, which may answer that the entry is in a closed
 * period; the Journal screen then asks the user once, and retries confirmed.
 * The note saves when the field loses focus, as the prototype's does.
 */
export default function AdjustingEntryControl({
  entry,
  canEdit,
  unlocked,
  onChange,
  onClosedPeriod,
}: {
  entry: JournalEntrySummary;
  canEdit: boolean;
  unlocked: boolean;
  onChange: (mark: JournalEntrySummary["adjusting"]) => void;
  onClosedPeriod: (ask: ClosedPeriodAsk, retryConfirmed: () => Promise<void>) => void;
}) {
  const { message } = App.useApp();
  const [note, setNote] = useState(entry.adjusting?.note ?? "");
  const [busy, setBusy] = useState(false);
  const marked = entry.adjusting !== null;

  if (!canEdit) {
    return marked ? (
      <div style={{ marginTop: 10 }}>
        <strong>Adjusting entry</strong>
        {entry.adjusting?.note ? ` — ${entry.adjusting.note}` : ""}
      </div>
    ) : null;
  }

  const toggle = async (next: boolean, confirmClosed: boolean): Promise<void> => {
    setBusy(true);
    const r = next
      ? await markAdjustingAction({ entryId: entry.id, note: null, confirmClosed })
      : await unmarkAdjustingAction({ entryId: entry.id, confirmClosed });
    setBusy(false);
    if (!r.ok || !r.data) {
      message.error(r.error ?? "The entry could not be changed.");
      return;
    }
    if (r.data.kind === "closed_period") {
      onClosedPeriod(r.data.ask, () => toggle(next, true));
      return;
    }
    setNote("");
    onChange(next ? { note: null } : null);
  };

  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed === (entry.adjusting?.note ?? "")) return;
    setBusy(true);
    const r = await markAdjustingAction({ entryId: entry.id, note: trimmed || null, confirmClosed: unlocked });
    setBusy(false);
    if (!r.ok || !r.data || r.data.kind !== "done") {
      message.error(r.error ?? "The note could not be saved.");
      return;
    }
    onChange({ note: trimmed || null });
  };

  return (
    <Space wrap size={10} style={{ marginTop: 10 }}>
      <Checkbox checked={marked} disabled={busy} onChange={(e) => void toggle(e.target.checked, unlocked)}>
        Adjusting entry
      </Checkbox>
      {marked ? (
        <Input
          size="small"
          style={{ width: 320, maxWidth: "100%" }}
          maxLength={ADJUSTING_NOTE_MAX}
          placeholder="Why it was adjusted"
          aria-label="Why it was adjusted"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void saveNote()}
        />
      ) : null}
    </Space>
  );
}
