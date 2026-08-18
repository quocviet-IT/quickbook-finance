"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  BankOutlined,
  CloudSyncOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import BankTransactionsFilters, { ALL_ACCOUNTS } from "./BankTransactionsFilters";
import { EmptyState } from "@/components/ui/PageStates";
import BankTransactionsTable from "./BankTransactionsTable";
import BankImportList from "./BankImportList";
import DeleteBankLineModal, {
  type DeleteBankLineTarget,
} from "./DeleteBankLineModal";
import BatchAssignAccountModal, { type BatchAssignTarget } from "./BatchAssignAccountModal";
import { pruneSelection } from "@/lib/domain/bank-transaction-batch";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import {
  BANK_SETUP_DETAIL_TYPES,
  bankDetailLabel,
  selectableBankLedgerAccounts,
  suggestBankLedgerAccount,
  suggestNewLedgerAccount,
  type BankDetailType,
} from "@/lib/domain/bank-account-detail";
import { createAccountAction } from "@/app/(app)/accounts/actions";
import type {
  AccountRow,
  BankTransactionRow,
  BankTxnStatus,
  CurrencyRow,
} from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import type {
  BankAccountWithGl,
  BankConnectionView,
  SuggestionView,
} from "@/lib/services/banking";
import { parseCsv } from "@/lib/csv";
import { buildBankReviewRows, type BankReviewRow } from "@/lib/domain/banking-import";
import {
  filterBankTransactions,
  parseAmountFilterInput,
  type AmountFilter,
} from "@/lib/domain/transaction-filter";
import { TOKENS } from "@/lib/design/tokens";
import SettleFromBankModal, { type SettleTarget } from "@/components/banking/SettleFromBankModal";
import {
  describeStatementParse,
  parseStatementRows,
} from "@/lib/domain/statement-import";
import { formatMoney } from "@/lib/format";
import {
  approveReconciliationAction,
  connectPlaidBankAction,
  createBankAccountAction,
  createPlaidLinkTokenAction,
  generateSuggestionsAction,
  getSuggestionsAction,
  getBankPostingsAction,
  getTransactionsAction,
  importStatementAction,
  rejectReconciliationAction,
  syncBankConnectionAction,
} from "./actions";

interface PlaidLinkAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

interface PlaidLinkMetadata {
  institution: { institution_id: string; name: string } | null;
  accounts: PlaidLinkAccount[];
}

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (options: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        onExit: (error: { display_message?: string; error_message?: string } | null) => void;
      }) => PlaidHandler;
    };
  }
}

type ReviewRow = BankReviewRow<BankTransactionRow, SuggestionView>;

function formatSyncTime(value: string | null): string {
  if (!value) return "Not synchronized yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

interface ParsedRow {
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string;
}

interface PendingPlaidLink {
  publicToken: string;
  institutionId: string | null;
  institutionName: string;
  accounts: PlaidLinkAccount[];
}

export default function BankingClient({
  bankAccounts,
  accounts,
  initialAccountId,
  initialQueueStatus,
  initialFocusId,
  bankConnections,
  glBankAccounts,
  currencies,
  canWrite,
  plaidConfigured,
  plaidEnvironment,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  scannerConfigured,
}: {
  bankAccounts: BankAccountWithGl[];
  /** The labels a bank line may carry; a new one is appended as it is created. */
  /** The whole chart, so a line can be posted to any account money may go to. */
  accounts: AccountRow[];
  initialAccountId: string | null;
  initialQueueStatus: "unmatched" | null;
  initialFocusId: string | null;
  bankConnections: BankConnectionView[];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
  plaidConfigured: boolean;
  plaidEnvironment: string;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  scannerConfigured: boolean;
}) {
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    bankAccounts.some((account) => account.id === initialAccountId)
      ? initialAccountId!
      : bankAccounts[0]?.id,
  );
  const [transactionStatus, setTransactionStatus] = useState<"all" | BankTxnStatus>(
    initialQueueStatus ?? "all",
  );
  // Keyword and amount (RQ-02): raw text kept separate from the parsed
  // AmountFilter so a half-typed number ("12" on the way to "125.00") shows
  // in the box as typed rather than fighting a parse failure every keystroke.
  const [keyword, setKeyword] = useState("");
  const [exactAmountText, setExactAmountText] = useState("");
  const [minAmountText, setMinAmountText] = useState("");
  const [maxAmountText, setMaxAmountText] = useState("");
  const [txns, setTxns] = useState<BankTransactionRow[]>([]);
  // What each matched line was posted to. Fetched beside the transactions so
  // the Category column can show the answer instead of asking over the top of
  // it — fifteen lines read "Uncategorized" beside "Matched".
  const [postings, setPostings] = useState<Map<string, BankPostingRow>>(new Map());
  const [postedToFilter, setPostedToFilter] = useState<string>("all");
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null);
  // Bumped after an import so the register below picks the new batch up.
  const [importsKey, setImportsKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DeleteBankLineTarget | null>(null);
  // RQ-03: the raw picks a reader has made. Never read directly — always
  // through the `selectedIds` projection below, which is what stays true to
  // "must not keep rows that have dropped out of the filtered set" on every
  // render rather than only after some effect catches up.
  const [rawSelectedIds, setRawSelectedIds] = useState<string[]>([]);
  const [batchTarget, setBatchTarget] = useState<BatchAssignTarget | null>(null);

  const [acctForm] = Form.useForm();
  const [acctOpen, setAcctOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");

  const [pendingLink, setPendingLink] = useState<PendingPlaidLink | null>(null);
  const [mappingSelections, setMappingSelections] = useState<Record<string, string | undefined>>({});
  const oauthResumeStarted = useRef(false);

  // Anywhere money may actually land. A heading cannot carry a balance, and an
  // account somebody retired should not quietly come back through this column.
  const postableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.is_posting_account && account.status === "active",
      ),
    [accounts],
  );

  // Undefined in the all-accounts view, which is why anything account-specific
  // — importing a statement, running the matcher, the feed panel — checks it.
  const selected = bankAccounts.find((account) => account.id === selectedId);
  const allAccounts = selectedId === ALL_ACCOUNTS;
  const selectedConnection = bankConnections.find((connection) =>
    connection.accounts.some((account) => account.bank_account_id === selectedId),
  );
  const connectedBookAccountIds = useMemo(
    () => new Set(bankConnections.flatMap((connection) => connection.accounts.map((account) => account.bank_account_id))),
    [bankConnections],
  );
  const decimalsOf = (code: string) => currencies.find((currency) => currency.code === code)?.decimal_places ?? 2;
  const decimalPlaces = selected ? decimalsOf(selected.currency_code) : 2;
  // The amount boxes are parsed with the selected account's own currency
  // decimals (2 for USD, which is every account this product supports today
  // — see decimalPlaces above). The all-accounts queue can in principle mix
  // currencies with different decimal places; this filter does not attempt
  // cross-currency amount matching, the same simplification the CSV importer
  // above already makes with this same decimalPlaces value.
  const amountFilter: AmountFilter = {
    exactMinor: parseAmountFilterInput(exactAmountText, decimalPlaces),
    minMinor: parseAmountFilterInput(minAmountText, decimalPlaces),
    maxMinor: parseAmountFilterInput(maxAmountText, decimalPlaces),
  };
  const hasKeywordOrAmountFilter =
    keyword.trim() !== "" || exactAmountText.trim() !== "" || minAmountText.trim() !== "" || maxAmountText.trim() !== "";
  /**
   * A row's own currency, not the screen's. The all-accounts queue holds several
   * at once, and a card line formatted as dollars is a wrong number on screen.
   */
  const rowMoney = (row: ReviewRow) =>
    row.currencyCode
      ? formatMoney(row.transaction.amount_minor, row.currencyCode, decimalsOf(row.currencyCode))
      : String(row.transaction.amount_minor);

  const reload = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    // ALL_ACCOUNTS asks the server for every account at once; the review queue
    // is one list, and which bank a line came from is a column, not a mode.
    const accountFilter = selectedId === ALL_ACCOUNTS ? null : selectedId;
    const [transactions, matches, posted] = await Promise.all([
      getTransactionsAction(accountFilter),
      getSuggestionsAction(accountFilter),
      getBankPostingsAction(accountFilter),
    ]);
    setLoading(false);
    if (transactions.ok && transactions.data) setTxns(transactions.data);
    if (matches.ok && matches.data) setSuggestions(matches.data);
    if (posted.ok && posted.data) {
      setPostings(new Map(posted.data.map((row) => [row.bank_transaction_id, row])));
    }
  }, [selectedId]);

  useEffect(() => {
    // Intentional synchronization after the selected account changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function submitAccount() {
    const values = await acctForm.validateFields();
    const result = await createBankAccountAction(values);
    if (result.ok) {
      message.success("Bank account created");
      setAcctOpen(false);
      acctForm.resetFields();
      window.location.reload();
    } else {
      message.error(result.error ?? "Failed to create bank account");
    }
  }

  function launchPlaidLink(linkToken: string, receivedRedirectUri?: string) {
    if (!window.Plaid) return;
    const handler = window.Plaid.create({
      token: linkToken,
      receivedRedirectUri,
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        sessionStorage.removeItem("ctyhp_plaid_link_token");
        if (receivedRedirectUri) window.history.replaceState({}, "", "/banking");
        if (!metadata.institution || !metadata.accounts.length) {
          message.error("No financial institution account was selected");
          return;
        }
        const initialSelections: Record<string, string | undefined> = {};
        for (const providerAccount of metadata.accounts) {
          const maskMatch = bankAccounts.find(
            (bookAccount) =>
              !connectedBookAccountIds.has(bookAccount.id) &&
              providerAccount.mask &&
              bookAccount.account_number_masked?.endsWith(providerAccount.mask),
          );
          initialSelections[providerAccount.id] = maskMatch?.id;
        }
        setMappingSelections(initialSelections);
        setPendingLink({
          publicToken,
          institutionId: metadata.institution.institution_id,
          institutionName: metadata.institution.name,
          accounts: metadata.accounts,
        });
      },
      onExit: (error) => {
        handler.destroy();
        if (error) message.error(error.display_message || error.error_message || "Bank connection was not completed");
      },
    });
    handler.open();
  }

  function resumePlaidOAuth() {
    if (oauthResumeStarted.current || !window.Plaid) return;
    const isOAuthReturn = new URLSearchParams(window.location.search).has("oauth_state_id");
    const linkToken = sessionStorage.getItem("ctyhp_plaid_link_token");
    if (!isOAuthReturn || !linkToken) return;
    oauthResumeStarted.current = true;
    launchPlaidLink(linkToken, window.location.href);
  }

  async function openPlaidLink() {
    if (!plaidConfigured) {
      message.error("Configure the Plaid credentials and bank-feed encryption key on the server first");
      return;
    }
    if (!window.Plaid) {
      message.error("The secure bank connection window is still loading. Try again in a moment.");
      return;
    }
    setBusy("plaid-link");
    const result = await createPlaidLinkTokenAction();
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to initialize the bank connection");
      return;
    }
    sessionStorage.setItem("ctyhp_plaid_link_token", result.data.linkToken);
    launchPlaidLink(result.data.linkToken);
  }

  async function confirmPlaidMapping() {
    if (!pendingLink) return;
    const mappings = pendingLink.accounts
      .map((account) => ({
        provider_account_id: account.id,
        bank_account_id: mappingSelections[account.id],
      }))
      .filter((mapping): mapping is { provider_account_id: string; bank_account_id: string } =>
        Boolean(mapping.bank_account_id),
      );
    if (!mappings.length) {
      message.error("Map at least one connected account to a ledger bank account");
      return;
    }
    if (new Set(mappings.map((mapping) => mapping.bank_account_id)).size !== mappings.length) {
      message.error("Each provider account must map to a different ledger account");
      return;
    }

    setBusy("plaid-save");
    const result = await connectPlaidBankAction({
      publicToken: pendingLink.publicToken,
      institutionId: pendingLink.institutionId,
      institutionName: pendingLink.institutionName,
      mappings,
    });
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to save the bank connection");
      return;
    }
    message.success(
      `Bank connected. Imported ${result.data.added} transaction(s) and created ${result.data.suggestions} match suggestion(s).`,
    );
    setPendingLink(null);
    window.location.reload();
  }

  async function synchronizeFeed() {
    if (!selectedConnection) return;
    setBusy("sync");
    const result = await syncBankConnectionAction(selectedConnection.id);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Bank feed synchronization failed");
      return;
    }
    message.success(
      `Synchronized: ${result.data.added} new, ${result.data.modified} updated, ` +
        `${result.data.removed} removed, ${result.data.suggestions} match suggestion(s).`,
    );
    window.location.reload();
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      // Parsing rules live in lib/domain/statement-import.ts, where the shapes
      // real banks export are covered by tests.
      const result = parseStatementRows(parseCsv(String(reader.result)), {
        decimals: decimalPlaces,
      });
      setParsed(result.rows);
      setFileName(file.name);
      message.info(describeStatementParse(result));
    };
    reader.readAsText(file);
    return false;
  }

  async function confirmImport() {
    if (!selectedId || !parsed.length) return;
    setBusy("import");
    const result = await importStatementAction(selectedId, fileName, parsed);
    setBusy(null);
    if (result.ok && result.data) {
      message.success(
        `Imported ${result.data.inserted} transaction(s); ${result.data.skipped} duplicate(s) skipped`,
      );
      setImportOpen(false);
      setParsed([]);
      setImportsKey((count) => count + 1);
      reload();
    } else {
      message.error(result.error ?? "Import failed");
    }
  }

  async function findMatches() {
    if (!selectedId) return;
    setBusy("match");
    const result = await generateSuggestionsAction(selectedId);
    setBusy(null);
    if (result.ok && result.data) {
      message.success(`${result.data.count} new ledger match suggestion(s)`);
      reload();
    } else {
      message.error(result.error ?? "Failed to find ledger matches");
    }
  }

  async function approve(id: string) {
    setBusy(id);
    const result = await approveReconciliationAction(id);
    setBusy(null);
    if (result.ok) {
      message.success("Match approved");
      reload();
    } else {
      message.error(result.error ?? "Failed to approve the match");
    }
  }

  async function reject(id: string) {
    setBusy(id);
    const result = await rejectReconciliationAction(id);
    setBusy(null);
    if (result.ok) reload();
    else message.error(result.error ?? "Failed to reject the match");
  }

  function openSettle(row: ReviewRow) {
    setSettleTarget({
      id: row.transaction.id,
      txnDate: row.transaction.txn_date,
      description: row.transaction.description,
      amountMinor: row.transaction.amount_minor,
      currencyCode: row.currencyCode,
      decimals: row.currencyCode ? decimalsOf(row.currencyCode) : 2,
    });
  }


  if (!bankAccounts.length) {
    return (
      <>
        <EmptyState
          title="No bank accounts yet"
          description={
            glBankAccounts.length
              ? "Create the ledger bank account record before connecting a financial institution."
              : "Create a Bank-type account in the Chart of Accounts first."
          }
          action={
            canWrite ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  acctForm.setFieldsValue({ currency_code: "USD" });
                  setAcctOpen(true);
                }}
                disabled={!glBankAccounts.length}
              >
                Add bank account
              </Button>
            ) : null
          }
        />
        <CreateAccountModal
          open={acctOpen}
          onCancel={() => setAcctOpen(false)}
          onOk={submitAccount}
          form={acctForm}
          glBankAccounts={glBankAccounts}
          currencies={currencies}
        />
      </>
    );
  }

  const unmatchedCount = txns.filter((transaction) => transaction.status === "unmatched").length;
  const visibleTransactions =
    transactionStatus === "all"
      ? txns
      : txns.filter((transaction) => transaction.status === transactionStatus);

  // "Uncategorized" is the option that makes labels worth having: it is how you
  // find the lines nobody has looked at yet.
  const categorized = visibleTransactions.filter((transaction) => {
    if (postedToFilter === "all") return true;
    // "Not categorised yet" means still awaiting review, not merely "no account
    // to show" — a line settled against an invoice is posted and has neither.
    if (postedToFilter === "none") return transaction.status === "unmatched";
    return postings.get(transaction.id)?.account_id === postedToFilter;
  });

  // RQ-02: keyword (Description, Reference) and amount, composed with the
  // account/status/posted-to filters above rather than replacing them — all
  // four narrow the same in-browser `txns` array, which holds every
  // transaction for the selection, not just the rows the paginator currently
  // shows.
  const keywordAndAmountFiltered = filterBankTransactions(categorized, keyword, amountFilter);

  // Each row carries the account it came from, that account's currency, and its
  // best suggested match — so one table can answer what a line is and where it
  // came from without sending anyone to a second screen.
  const reviewRows = buildBankReviewRows(
    keywordAndAmountFiltered,
    suggestions,
    bankAccounts.map((account) => ({
      id: account.id,
      name: `${account.bank_name || account.account_name} · ${account.account_code}`,
      currency_code: account.currency_code,
    })),
  );

  // RQ-03: dropped the instant a row is no longer reachable through the
  // current account/status/posted-to/keyword/amount filters, kept if it is
  // merely on a different page of the same filtered set — see
  // lib/domain/bank-transaction-batch.ts for why turning the page is not
  // treated the same as narrowing a filter. Recomputed on every render
  // rather than synced through an effect, so there is never a render where a
  // filtered-out id is still counted as selected.
  const selectedIds = pruneSelection(
    rawSelectedIds,
    reviewRows.map((row) => row.transaction.id),
  );

  return (
    <div>
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        strategy="afterInteractive"
        onReady={resumePlaidOAuth}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <BankOutlined style={{ fontSize: 20, color: TOKENS.intent.primary }} />
          <div>
            <Typography.Text strong>
              {selectedConnection ? selectedConnection.institution_name : "No direct feed for this account"}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {selectedConnection
                ? `Last sync: ${formatSyncTime(selectedConnection.last_sync_at)}`
                : "File import remains available until a bank is connected."}
            </Typography.Text>
          </div>
          {selectedConnection ? (
            <Tag color={selectedConnection.status === "active" ? "green" : "orange"}>
              {selectedConnection.status.replaceAll("_", " ")}
            </Tag>
          ) : null}
          {plaidEnvironment !== "production" ? <Tag color="blue">{plaidEnvironment}</Tag> : null}
        </Space>
        {selectedConnection?.last_error ? (
          <Alert type="warning" showIcon message="The last synchronization needs attention" description={selectedConnection.last_error} style={{ marginTop: 12 }} />
        ) : null}
        {!plaidConfigured && canWrite ? (
          <Alert
            type="info"
            showIcon
            message="Direct bank feed is ready for configuration"
            description="Set PLAID_CLIENT_ID, PLAID_SECRET, and BANK_FEED_ENCRYPTION_KEY in the server environment."
            style={{ marginTop: 12 }}
          />
        ) : null}
      </Card>

      <BankTransactionsFilters
        resultCount={reviewRows.length}
        actions={
          canWrite ? (
            <Space wrap>
              {glBankAccounts.length > 0 ? (
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    acctForm.setFieldsValue({ currency_code: "USD" });
                    setAcctOpen(true);
                  }}
                >
                  Add account
                </Button>
              ) : null}
              {!selectedConnection ? (
                <Button
                  icon={<LinkOutlined />}
                  loading={busy === "plaid-link"}
                  disabled={!plaidConfigured}
                  onClick={openPlaidLink}
                >
                  Connect bank
                </Button>
              ) : (
                <Button icon={<CloudSyncOutlined />} loading={busy === "sync"} onClick={synchronizeFeed}>
                  Sync now
                </Button>
              )}
              {/* Both act on one account's statement, so neither is offered
                  while the queue is showing every account at once. */}
              <Button
                icon={<ThunderboltOutlined />}
                loading={busy === "match"}
                disabled={allAccounts}
                title={allAccounts ? "Choose a single account to run matching" : undefined}
                onClick={findMatches}
              >
                Find ledger matches
              </Button>
              <Button
                type="primary"
                icon={<InboxOutlined />}
                disabled={allAccounts}
                title={allAccounts ? "Choose a single account to import into" : undefined}
                onClick={() => setImportOpen(true)}
              >
                Import statement
              </Button>
            </Space>
          ) : null
        }
        bankAccounts={bankAccounts}
        selectedId={selectedId}
        onSelectedId={setSelectedId}
        transactionStatus={transactionStatus}
        onTransactionStatus={setTransactionStatus}
        unmatchedCount={unmatchedCount}
        postedToFilter={postedToFilter}
        onPostedTo={setPostedToFilter}
        postings={postings}
        keyword={keyword}
        onKeyword={setKeyword}
        suggestionRows={categorized}
        exactAmountText={exactAmountText}
        onExactAmount={setExactAmountText}
        minAmountText={minAmountText}
        onMinAmount={setMinAmountText}
        maxAmountText={maxAmountText}
        onMaxAmount={setMaxAmountText}
        hasFindFilter={hasKeywordOrAmountFilter}
        onClearFind={() => {
          setKeyword("");
          setExactAmountText("");
          setMinAmountText("");
          setMaxAmountText("");
        }}
        suggestedMatchCount={suggestions.length}
      />

      <BankTransactionsTable
        rows={reviewRows}
        loading={loading}
        initialFocusId={initialFocusId}
        canWrite={canWrite}
        canReadDocuments={canReadDocuments}
        busy={busy}
        formatRowMoney={rowMoney}
        postableAccounts={postableAccounts}
        postings={postings}
        onCategorised={reload}
        onSettle={openSettle}
        onApprove={approve}
        onReject={reject}
        onDelete={(row, eligibility) => {
          // The control is disabled whenever eligibility.kind is "blocked",
          // so this only fires for "delete_only" or "void_then_delete" in
          // practice; the check is defense in depth, not the real gate.
          if (eligibility.kind === "blocked") return;
          setDeleteTarget({
            id: row.transaction.id,
            txnDate: row.transaction.txn_date,
            description: row.transaction.description,
            amount: rowMoney(row),
            eligibility,
          });
        }}
        onAttachments={(row) =>
          setAttachmentTarget({
            entityType: "bank_transaction",
            entityId: row.transaction.id,
            label: `${row.transaction.txn_date} · ${row.transaction.description}`,
          })
        }
        selectedIds={selectedIds}
        onSelectionChange={setRawSelectedIds}
        onBatchAssign={(kind) =>
          setBatchTarget({
            kind,
            rows: reviewRows
              .filter((row) => selectedIds.includes(row.transaction.id))
              .map((row) => ({
                id: row.transaction.id,
                status: row.transaction.status,
                txnDate: row.transaction.txn_date,
                description: row.transaction.description,
                amount: rowMoney(row),
              })),
          })
        }
      />

      <Card
        size="small"
        title="Statement imports"
        style={{ marginTop: 16 }}
        styles={{ body: { padding: 0 } }}
      >
        <BankImportList
          bankAccountId={selectedId === ALL_ACCOUNTS ? null : (selectedId ?? null)}
          canWrite={canWrite}
          reloadKey={importsKey}
          onChanged={reload}
        />
      </Card>

      <DeleteBankLineModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          setImportsKey((count) => count + 1);
          reload();
        }}
      />

      <BatchAssignAccountModal
        target={batchTarget}
        accounts={postableAccounts}
        onClose={() => setBatchTarget(null)}
        onDone={(succeededIds) => {
          setBatchTarget(null);
          // Only the rows that actually changed drop out of the selection —
          // a skipped or failed row stays checked, so a partial result leaves
          // something to act on rather than a count nobody can trace back to
          // a row.
          setRawSelectedIds((current) => current.filter((id) => !succeededIds.includes(id)));
          reload();
        }}
      />

      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />

      {/* Keyed so each bank line gets a fresh dialog rather than one that has
          to remember to forget the previous line's allocations. */}
      {settleTarget ? (
        <SettleFromBankModal
          key={settleTarget.id}
          target={settleTarget}
          onClose={() => setSettleTarget(null)}
          onDone={() => {
            setSettleTarget(null);
            reload();
          }}
        />
      ) : null}

      <Modal
        title="Import bank statement"
        open={importOpen}
        onOk={confirmImport}
        onCancel={() => {
          setImportOpen(false);
          setParsed([]);
        }}
        okText={parsed.length ? `Import ${parsed.length} rows` : "Import"}
        okButtonProps={{ disabled: !parsed.length, loading: busy === "import" }}
        cancelText="Cancel"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          Upload a comma-separated values file with columns: <code>date, description, amount, reference, balance</code>.
          Positive amounts are money in. Dates may use YYYY-MM-DD or MM/DD/YYYY.
        </Typography.Paragraph>
        <Upload.Dragger accept=".csv" beforeUpload={handleFile} maxCount={1} showUploadList={{ showRemoveIcon: false }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Click or drag a comma-separated values file here</p>
        </Upload.Dragger>
        {parsed.length > 0 ? (
          <Typography.Paragraph style={{ marginTop: 12 }}>
            Parsed <strong>{parsed.length}</strong> transactions from <strong>{fileName}</strong>.
          </Typography.Paragraph>
        ) : null}
      </Modal>

      <Modal
        title={`Map ${pendingLink?.institutionName ?? "bank"} accounts`}
        open={Boolean(pendingLink)}
        onOk={confirmPlaidMapping}
        onCancel={() => setPendingLink(null)}
        okText="Connect and synchronize"
        okButtonProps={{ loading: busy === "plaid-save" }}
        width={700}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="Map each external account to its matching General Ledger bank account."
          description="Unmapped accounts will not be imported. Currency must agree between the provider and the ledger."
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {pendingLink?.accounts.map((account) => (
            <div key={account.id}>
              <Typography.Text strong>
                {account.name}{account.mask ? ` ••••${account.mask}` : ""}
              </Typography.Text>
              <Typography.Text type="secondary"> · {account.type} / {account.subtype ?? "other"}</Typography.Text>
              <Select
                allowClear
                placeholder="Select General Ledger bank account"
                style={{ width: "100%", marginTop: 6 }}
                value={mappingSelections[account.id]}
                onChange={(value) =>
                  setMappingSelections((current) => ({ ...current, [account.id]: value }))
                }
                options={bankAccounts
                  .filter((bookAccount) => !connectedBookAccountIds.has(bookAccount.id))
                  .map((bookAccount) => ({
                    value: bookAccount.id,
                    label: `${bookAccount.account_code} — ${bookAccount.account_name} (${bookAccount.currency_code})`,
                  }))}
              />
            </div>
          ))}
        </Space>
      </Modal>

      <CreateAccountModal
        open={acctOpen}
        onCancel={() => setAcctOpen(false)}
        onOk={submitAccount}
        form={acctForm}
        glBankAccounts={glBankAccounts}
        currencies={currencies}
      />
    </div>
  );
}

function CreateAccountModal({
  open,
  onCancel,
  onOk,
  form,
  glBankAccounts,
  currencies,
}: {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  form: ReturnType<typeof Form.useForm>[0];
  glBankAccounts: AccountRow[];
  currencies: CurrencyRow[];
}) {
  const { message } = App.useApp();
  const chosenDetail: BankDetailType | undefined = Form.useWatch("detail_type", form);
  const bankName: string | undefined = Form.useWatch("bank_name", form);
  const [created, setCreated] = useState<AccountRow[]>([]);
  const [creating, setCreating] = useState(false);

  // Accounts created from inside this dialog join the picker without a reload;
  // the page reloads anyway once the bank account itself is saved.
  const available = [...glBankAccounts, ...created];
  const selectableAccounts = selectableBankLedgerAccounts(available, {
    detail: chosenDetail ?? null,
  });

  /**
   * A bank account needs a ledger account of its own, and a chart rarely has a
   * spare one waiting. Rather than sending someone to another screen and back,
   * the code and name are proposed here and they confirm them — still a
   * deliberate act, just not a detour.
   */
  async function createLedgerAccount() {
    if (!chosenDetail) {
      message.warning("Choose the kind of account first");
      return;
    }
    const proposal = suggestNewLedgerAccount(available, chosenDetail, bankName);
    setCreating(true);
    const res = await createAccountAction({
      account_code: proposal.account_code,
      name: proposal.name,
      account_type: "bank",
      detail_type: proposal.detail_type,
      currency_code: "USD",
      is_posting_account: true,
      status: "active",
    });
    setCreating(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to create the ledger account");
      return;
    }
    const account = {
      id: res.data.id,
      account_code: res.data.account_code,
      name: res.data.name,
      account_type: "bank",
      detail_type: proposal.detail_type,
      is_posting_account: true,
      status: "active",
    } as AccountRow;
    setCreated((current) => [...current, account]);
    form.setFieldValue("account_id", account.id);
    message.success(`Created ${account.account_code} — ${account.name}`);
  }

  return (
    <Modal
      title="Add bank account"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText="Create"
      cancelText="Cancel"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="detail_type"
          label="What kind of account is this?"
          rules={[{ required: true, message: "Choose the kind of account" }]}
          extra="Cash on hand is not offered: physical cash has no bank statement to import."
        >
          <Select
            placeholder="Checking, savings, money market…"
            onChange={(value: BankDetailType) => {
              // Suggest the ledger account that matches, when exactly one does.
              const suggestion = suggestBankLedgerAccount(glBankAccounts, value);
              form.setFieldValue("account_id", suggestion?.id);
            }}
            options={BANK_SETUP_DETAIL_TYPES.map((detail) => ({
              value: detail,
              label: bankDetailLabel(detail),
            }))}
          />
        </Form.Item>
        <Form.Item
          name="account_id"
          label="General Ledger account"
          rules={[{ required: true, message: "Select an account" }]}
          extra={
            selectableAccounts.length === 0 && chosenDetail
              ? "No ledger account of this kind is free — create one below."
              : undefined
          }
        >
          <Select
            placeholder="Select a Bank-type account"
            notFoundContent="No matching ledger account"
            options={selectableAccounts.map((account) => ({
              value: account.id,
              label: `${account.account_code} — ${account.name}${
                account.detail_type ? "" : " (unclassified)"
              }`,
            }))}
          />
        </Form.Item>
        {chosenDetail ? (
          <Button
            size="small"
            loading={creating}
            style={{ marginBottom: 16 }}
            onClick={createLedgerAccount}
          >
            + New ledger account for a {bankDetailLabel(chosenDetail).toLowerCase()}
          </Button>
        ) : null}
        <Form.Item name="bank_name" label="Bank name" rules={[{ required: true, message: "Enter the bank name" }]}>
          <Input placeholder="e.g. First National Bank" />
        </Form.Item>
        <Form.Item name="account_number_masked" label="Account number (masked)">
          <Input placeholder="e.g. ****1234" />
        </Form.Item>
        <Form.Item name="currency_code" label="Currency" rules={[{ required: true, message: "Select a currency" }]}>
          <Select
            disabled
            options={currencies.map((currency) => ({
              value: currency.code,
              label: `${currency.code} — ${currency.name}`,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
