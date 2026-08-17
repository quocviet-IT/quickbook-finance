"use client";
import { useMemo, useState } from "react";
import { App, Alert, Button, Divider, Modal, Select, Space, Tooltip, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import { searchAccounts } from "@/lib/domain/account-search";
import {
  batchResultSeverity,
  describeBatchPreview,
  describeBatchResult,
  splitBatchEligibility,
  summarizeBatchResults,
  type BatchActionSummary,
} from "@/lib/domain/bank-transaction-batch";
import { batchCategoriseBankTransactionsAction, type BatchCategoriseOutcome } from "./actions";

export interface BatchAssignTargetRow {
  id: string;
  /** BankTxnStatus — "unmatched" is the only status eligible for this action. */
  status: string;
  txnDate: string;
  description: string;
  /** Pre-formatted by the caller, which already knows each row's own currency. */
  amount: string;
}

export interface BatchAssignTarget {
  /** Which button opened this — see the module doc in bank-transaction-batch.ts
   *  for why both post through the same call. */
  kind: "category" | "account";
  rows: BatchAssignTargetRow[];
}

export interface BatchAssignAccountModalProps {
  target: BatchAssignTarget | null;
  /** Every account money may be posted to, for the same search CategoriseCell uses. */
  accounts: AccountRow[];
  onClose: () => void;
  /** Called once the reader dismisses the result, with the ids that actually
   *  changed — so the caller can drop only those from the selection and leave
   *  skipped/failed rows selected for a second look. */
  onDone: (succeededIds: string[]) => void;
}

/**
 * Set Category / Set Account for a batch of selected bank lines (RQ-05).
 *
 * Two steps in one dialog: a confirmation that states how many rows will
 * change and how many will be skipped because they are already posted
 * (required before saving), then — after Save — a result that names
 * successes, failures and skips by count, with each failure's own reason.
 * RQ-05 forbids a partial failure reading as complete success; there is no
 * plain "Done" message here that does not first say how many rows changed.
 */
export default function BatchAssignAccountModal({
  target,
  accounts,
  onClose,
  onDone,
}: BatchAssignAccountModalProps) {
  const { message } = App.useApp();
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<BatchCategoriseOutcome[] | null>(null);

  const { eligible, skipped } = useMemo(
    () => splitBatchEligibility(target?.rows ?? []),
    [target],
  );

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
        via: hit.via,
      })),
    [accounts, query],
  );

  const rowById = useMemo(() => new Map((target?.rows ?? []).map((row) => [row.id, row])), [target]);

  const reset = () => {
    setAccountId(undefined);
    setQuery("");
    setOutcomes(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const finishAfterResult = () => {
    const succeeded = (outcomes ?? []).filter((outcome) => outcome.ok).map((outcome) => outcome.id);
    reset();
    onDone(succeeded);
  };

  async function confirm() {
    if (!accountId || !eligible.length) return;
    setBusy(true);
    const result = await batchCategoriseBankTransactionsAction(
      eligible.map((row) => row.id),
      accountId,
    );
    setBusy(false);
    if (!result.ok || !result.data) {
      // A denial that applies to the whole batch (no permission, nothing
      // selected) — the dialog stays open on the confirmation step so the
      // reader can see why nothing ran.
      message.error(result.error ?? "Could not run the batch action");
      return;
    }
    setOutcomes(result.data.outcomes);
  }

  const title = target?.kind === "account" ? "Set Account" : "Set Category";
  const summary: BatchActionSummary | null = outcomes
    ? summarizeBatchResults(outcomes, skipped.length)
    : null;

  return (
    <Modal
      title={title}
      open={target !== null}
      onCancel={outcomes ? finishAfterResult : close}
      footer={
        outcomes ? (
          <Button type="primary" onClick={finishAfterResult}>
            Done
          </Button>
        ) : (
          <Space>
            <Button onClick={close}>Cancel</Button>
            <Button
              type="primary"
              loading={busy}
              disabled={!accountId || eligible.length === 0}
              onClick={() => void confirm()}
            >
              {eligible.length > 0 ? `Assign to ${eligible.length} transaction${eligible.length === 1 ? "" : "s"}` : "Nothing to assign"}
            </Button>
          </Space>
        )
      }
      destroyOnHidden
      width={560}
    >
      {!outcomes ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {describeBatchPreview(eligible.length, skipped.length)}
          </Typography.Paragraph>
          {skipped.length > 0 ? (
            <Alert
              type="info"
              showIcon
              message={`${skipped.length} of the selected transactions already ${skipped.length === 1 ? "has" : "have"} a journal entry`}
              description="A line that is already matched or settled is left exactly as it is — changing it would mean voiding its entry and posting a new one, which this batch action does not do."
            />
          ) : null}
          <Tooltip title="Choosing an account posts every eligible selected line to the ledger">
            <Select
              showSearch
              style={{ width: "100%" }}
              placeholder="Search accounts…"
              value={accountId}
              disabled={eligible.length === 0}
              filterOption={false}
              searchValue={query}
              onSearch={setQuery}
              onChange={setAccountId}
              options={options}
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
            />
          </Tooltip>
        </Space>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type={batchResultSeverity(summary!)}
            showIcon
            message={describeBatchResult(summary!)}
          />
          {summary!.failures.length > 0 ? (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <Typography.Text strong>What failed, and why</Typography.Text>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  {summary!.failures.map((failure) => {
                    const row = rowById.get(failure.id);
                    return (
                      <div key={failure.id}>
                        <Typography.Text>
                          {row ? `${row.txnDate} · ${row.description} · ${row.amount}` : failure.id}
                        </Typography.Text>
                        <br />
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          {failure.error}
                        </Typography.Text>
                      </div>
                    );
                  })}
                </Space>
              </div>
            </>
          ) : null}
        </Space>
      )}
    </Modal>
  );
}
