"use client";
import { useMemo, useState } from "react";
import { App, Button, Select, Space, Tooltip, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import { searchAccounts } from "@/lib/domain/account-search";
import type { BankPostingRow } from "@/lib/services/banking";
import { categoriseBankTransactionAction, uncategoriseBankTransactionAction } from "./actions";

export interface CategoriseCellProps {
  transactionId: string;
  status: string;
  /** Every account money may be posted to, for the search. */
  accounts: AccountRow[];
  /** What this line was posted to, when it has been. */
  posting: BankPostingRow | null;
  canWrite: boolean;
  onChanged: () => void;
}

/**
 * Which account the other side of this money belongs to.
 *
 * This column used to hold a free-form label — a word somebody had to invent
 * first, saved beside the line and posted nowhere. Every company had zero of
 * them, so it was an empty dropdown, and the complaint was exact: "I can't
 * categorize a transaction". What categorising means in bookkeeping is naming
 * the account, and having the books say it too. So it names the account, and
 * choosing one posts the entry.
 *
 * A line already matched is not asked again. It had an answer — the account its
 * entry posted to — and asking over the top of it was the other half of the
 * confusion: "Uncategorized" sat beside "Matched" on fifteen lines that were
 * already in the ledger.
 */
export default function CategoriseCell({
  transactionId,
  status,
  accounts,
  posting,
  canWrite,
  onChanged,
}: CategoriseCellProps) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  /**
   * Ranked here rather than by the dropdown, so the order is ours: an exact
   * code first, then the chart's own wording, then a word that means the same.
   * A chart of ninety-five accounts answering to "sales" is not a shortlist.
   */
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
        // What a keyboard match runs against, and what the closed control shows.
        label: `${hit.account.account_code} — ${hit.account.name}`,
        type: hit.account.account_type,
        via: hit.via,
      })),
    [accounts, query],
  );

  if (posting) {
    const label = `${posting.account_code} — ${posting.account_name}`;
    return (
      <Space direction="vertical" size={0}>
        <Typography.Text>{label}</Typography.Text>
        <Space size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {posting.entry_number ?? "posted"}
          </Typography.Text>
          {canWrite && posting.own_entry ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontSize: 12 }}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const res = await uncategoriseBankTransactionAction(transactionId);
                setBusy(false);
                if (!res.ok) {
                  message.error(res.error ?? "Could not undo this");
                  return;
                }
                message.success("Entry voided. The line is awaiting review again.");
                onChanged();
              }}
            >
              Change
            </Button>
          ) : null}
        </Space>
      </Space>
    );
  }

  // Matched, but by something that owns its own entry — an invoice settled from
  // this line, or a transactions import. Saying nothing is better than offering
  // a control that would refuse.
  if (status !== "unmatched") {
    return <Typography.Text type="secondary">Matched elsewhere</Typography.Text>;
  }

  if (!canWrite) return <Typography.Text type="secondary">—</Typography.Text>;

  return (
    <Tooltip title="Choosing an account posts this line to the ledger">
      <Select
        showSearch
        style={{ minWidth: 240 }}
        placeholder="Search accounts…"
        loading={busy}
        disabled={busy}
        // The list is already filtered and ranked; antd must not filter again.
        filterOption={false}
        searchValue={query}
        onSearch={setQuery}
        options={options}
        // Which report the money will land in, and which side of the books it
        // sits on — the reader asked for exactly this: "if it is debit, if it
        // is credit, anything".
        optionRender={(option) => (
          <Space direction="vertical" size={0}>
            <span>{option.data.label}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {ACCOUNT_TYPE_LABEL[option.data.type as AccountType]} ·{" "}
              {normalBalanceOf(option.data.type as AccountType) === "debit" ? "Debit" : "Credit"}
              {option.data.via ? ` · matched on “${option.data.via}”` : ""}
            </Typography.Text>
          </Space>
        )}
        onChange={async (accountId: string) => {
          setBusy(true);
          const res = await categoriseBankTransactionAction(transactionId, accountId);
          setBusy(false);
          if (!res.ok || !res.data) {
            message.error(res.error ?? "Could not categorise this line");
            return;
          }
          message.success(
            `Posted to ${res.data.account_code} — ${res.data.account_name}` +
              (res.data.entry_number ? ` as ${res.data.entry_number}` : ""),
          );
          onChanged();
        }}
      />
    </Tooltip>
  );
}
