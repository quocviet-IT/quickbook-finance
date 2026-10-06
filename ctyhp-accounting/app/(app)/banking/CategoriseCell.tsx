"use client";
import { useMemo, useState } from "react";
import { App, Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import { searchAccounts } from "@/lib/domain/account-search";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { isHoldingDetail } from "@/lib/domain/uncategorized";
import { formatMoney } from "@/lib/format";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import LoanSplitModal from "./LoanSplitModal";
import {
  categoriseBankTransactionAction,
  postLoanPaymentAction,
  recodeUncategorizedAction,
  uncategoriseBankTransactionAction,
  undoRecodeAction,
} from "./actions";

export interface CategoriseCellProps {
  transactionId: string;
  status: string;
  /** Every account money may be posted to, for the search. */
  accounts: AccountRow[];
  /** What this line was posted to, when it has been; `others` names the rest of a split entry. */
  posting: (BankPostingRow & { others?: string[] }) | null;
  canWrite: boolean;
  onChanged: () => void;
  /** What a rule or history suggests for this line, when it is waiting. */
  suggestion?: CodingSuggestionView | null;
  /** A registered loan's proposed split, for a waiting loan payment. */
  loan?: LoanSuggestionView | null;
  /** Opens the rule form, filled from this line. */
  onCreateRule?: () => void;
  /** The line is posted to an Uncategorized account (migration 0134). */
  holding?: boolean;
  /** Where a recode moved this line out of Uncategorized, when it has been. */
  recode?: BankRecodeRow | null;
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
  suggestion = null,
  loan = null,
  onCreateRule,
  holding = false,
  recode = null,
}: CategoriseCellProps) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [recoding, setRecoding] = useState(false);

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
  // A recode moves money out of Uncategorized, so it never goes back into one,
  // and a bank account is not a category (acc_recode_uncategorized refuses both).
  const recodeOptions = useMemo(() => {
    const holdingIds = new Set(accounts.filter((a) => isHoldingDetail(a.detail_type)).map((a) => a.id));
    return options.filter((option) => !holdingIds.has(option.value) && option.type !== "bank");
  }, [accounts, options]);

  async function recodeTo(accountId: string) {
    setBusy(true);
    const res = await recodeUncategorizedAction(transactionId, accountId);
    setBusy(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not recode this line");
      return;
    }
    message.success(
      `Recoded to ${res.data.account_code} — ${res.data.account_name}` + (res.data.entry_number ? ` (${res.data.entry_number})` : ""),
    );
    setRecoding(false);
    onChanged();
  }

  async function takeRecodeBack() {
    setBusy(true);
    const res = await undoRecodeAction(transactionId);
    setBusy(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not take the recode back");
      return;
    }
    message.success("Recode taken back. The line is in Uncategorized again.");
    onChanged();
  }

  async function post(accountId: string) {
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
  }

  async function postLoan(interestMinor: number) {
    if (!loan) return;
    setBusy(true);
    const res = await postLoanPaymentAction({ transactionId, repaymentId: loan.repaymentId, interestMinor });
    setBusy(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not post this loan payment");
      return;
    }
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    message.success(
      `Posted${res.data.entry_number ? ` as ${res.data.entry_number}` : ""}: principal ${money(res.data.principal_minor)}, interest ${money(res.data.interest_minor)}`,
    );
    setSplitting(false);
    onChanged();
  }

  const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
  const small = { fontSize: 12 } as const;

  /** The account search, for posting a waiting line and for recoding one out of Uncategorized. */
  const accountSelect = (list: typeof options, placeholder: string, onPick: (accountId: string) => void) => (
    <Select
      showSearch
      // Fills its column rather than declaring a minimum wider than one. A
      // 240px minimum inside a 150px column does not widen the column — it
      // spills over the Match column beside it, which is the fault a reader
      // screenshotted on the triage screen in its other form.
      style={{ width: "100%" }}
      // The dropdown is free to be wider than the cell, and needs to be: an
      // account reads "5000 — Cost of Goods Sold".
      popupMatchSelectWidth={320}
      placeholder={placeholder}
      loading={busy}
      disabled={busy}
      // The list is already filtered and ranked; antd must not filter again.
      filterOption={false}
      searchValue={query}
      onSearch={setQuery}
      options={list}
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
      onChange={onPick}
    />
  );

  /**
   * What a rule or the company's own history says this line is. One thing per
   * line, because the column is 150px: the account first, cut to the column
   * with the whole reason one hover away, then how sure — "2 of 2" or "Rule 2" —
   * and Use. Suggested only: nothing posts until Use is clicked.
   */
  const suggested = (withUse: boolean) =>
    suggestion ? (
      <>
        <Tooltip title={suggestion.why}>
          <Typography.Text type="secondary" style={{ ...small, display: "block", maxWidth: "100%" }} ellipsis>
            {suggestion.source === "history" ? "Usually " : "→ "}
            {suggestion.accountLabel}
          </Typography.Text>
        </Tooltip>
        <Space size={6}>
          <Typography.Text type="secondary" style={small}>
            {suggestion.short}
          </Typography.Text>
          {withUse ? (
            <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => void post(suggestion.accountId)}>
              Use
            </Button>
          ) : null}
        </Space>
      </>
    ) : null;
  /** A loan payment is two accounts, so it is posted from the Split dialog, never from Use. */
  const loanSuggested = (withSplit: boolean) =>
    loan ? (
      <>
        <Tooltip title={loan.why}>
          <Typography.Text type="secondary" style={{ ...small, display: "block", maxWidth: "100%" }} ellipsis>
            → {loan.loanAccountLabel}
          </Typography.Text>
        </Tooltip>
        <Space size={6}>
          <Typography.Text type="secondary" style={small}>
            Loan
          </Typography.Text>
          {withSplit ? (
            <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => setSplitting(true)}>
              Split…
            </Button>
          ) : null}
        </Space>
      </>
    ) : null;
  const splitDialog =
    splitting && loan ? (
      <LoanSplitModal
        paymentMinor={loan.paymentMinor}
        initialInterestMinor={loan.interestMinor}
        basis={loan.basis}
        loanAccountLabel={loan.loanAccountLabel}
        interestAccountLabel={loan.interestAccountLabel}
        okText="Post"
        confirmLoading={busy}
        onCancel={() => setSplitting(false)}
        onConfirm={(interestMinor) => void postLoan(interestMinor)}
      />
    ) : null;
  const createRule = onCreateRule ? (
    <div>
      <Button type="link" size="small" style={linkStyle} onClick={onCreateRule}>
        Create rule
      </Button>
    </div>
  ) : null;

  if (posting) {
    // A recoded line shows where its money went; the entry that put it in
    // Uncategorized stays as it was, under the recode.
    const main = recode ? `${recode.account_code} — ${recode.account_name}` : `${posting.account_code} — ${posting.account_name}`;
    const others = recode ? [] : (posting.others ?? []);
    const everyAccount = [main, ...others].join("; ");
    const mayChange = canWrite && posting.own_entry;
    return (
      <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
        {/* Cut to the column, with the whole account name on hover: an account
            is named by whoever set up the chart, and some run long. */}
        <Typography.Text ellipsis={{ tooltip: everyAccount }}>{main}</Typography.Text>
        {/* Its own line: beside the entry number and Change it does not fit a 150px column. */}
        {others.length ? (
          <Tooltip title={everyAccount}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              + {others.length} more account{others.length === 1 ? "" : "s"}
            </Typography.Text>
          </Tooltip>
        ) : null}
        {recode ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            recoded from Uncategorized{recode.entry_number ? ` · ${recode.entry_number}` : ""}
          </Typography.Text>
        ) : holding ? (
          <div>
            <Tag color="gold">needs coding</Tag>
          </div>
        ) : null}
        <Space size={6} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {posting.entry_number ?? "posted"}
          </Typography.Text>
          {mayChange && holding && !recode ? (
            <Button type="link" size="small" style={linkStyle} disabled={busy} onClick={() => setRecoding((open) => !open)}>
              Recode
            </Button>
          ) : null}
          {mayChange && recode ? (
            <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => void takeRecodeBack()}>
              Undo recode
            </Button>
          ) : null}
          {mayChange ? (
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
        {recoding && !recode ? (
          <Tooltip title="Choosing an account posts a second entry that moves this line out of Uncategorized">
            {accountSelect(recodeOptions, "Recode to…", (accountId) => void recodeTo(accountId))}
          </Tooltip>
        ) : null}
        {canWrite ? createRule : null}
      </Space>
    );
  }

  // Matched, but by something that owns its own entry — an invoice settled from
  // this line, or a transactions import. Saying nothing is better than offering
  // a control that would refuse.
  if (status !== "unmatched") {
    return <Typography.Text type="secondary">Matched elsewhere</Typography.Text>;
  }

  if (!canWrite) {
    return suggestion || loan ? (
      <div style={{ width: "100%", minWidth: 0 }}>
        {suggested(false)}
        {loanSuggested(false)}
      </div>
    ) : (
      <Typography.Text type="secondary">—</Typography.Text>
    );
  }

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <Tooltip title="Choosing an account posts this line to the ledger">
        {accountSelect(options, "Search accounts…", (accountId) => void post(accountId))}
      </Tooltip>
      {suggested(true)}
      {loanSuggested(true)}
      {splitDialog}
      {createRule}
    </div>
  );
}
