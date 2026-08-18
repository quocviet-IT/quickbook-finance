"use client";
import { useMemo, type ReactNode } from "react";
import { AutoComplete, Badge, Button, Input, Popover, Select, Space, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import FilterBar from "@/components/ui/FilterBar";
import type { BankTxnStatus } from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import { buildSearchSuggestions, type SearchableRow } from "@/lib/domain/transaction-search";

/** The sentinel the queue uses for "every connected account". */
export const ALL_ACCOUNTS = "__all__";

export interface BankTransactionsFiltersProps {
  bankAccounts: { id: string; bank_name: string | null; account_name: string; account_code: string; currency_code: string }[];
  selectedId: string | undefined;
  onSelectedId: (id: string) => void;

  transactionStatus: "all" | BankTxnStatus;
  onTransactionStatus: (status: "all" | BankTxnStatus) => void;
  unmatchedCount: number;

  postedToFilter: string;
  onPostedTo: (value: string) => void;
  postings: Map<string, BankPostingRow>;

  keyword: string;
  onKeyword: (value: string) => void;
  /**
   * The rows a suggestion may be built from: already narrowed by account,
   * status and posted-to, never narrowed by the keyword or amount. See
   * lib/domain/transaction-search.ts for why that boundary is the whole point.
   */
  suggestionRows: SearchableRow[];

  exactAmountText: string;
  onExactAmount: (value: string) => void;
  minAmountText: string;
  onMinAmount: (value: string) => void;
  maxAmountText: string;
  onMaxAmount: (value: string) => void;

  onClearFind: () => void;
  hasFindFilter: boolean;
  /** Suggested ledger matches awaiting a decision, for the note at the end. */
  suggestedMatchCount: number;

  /** How many rows the table is showing, reported by the bar. */
  resultCount: number;
  /** Connect bank, Find ledger matches, Import statement — the write actions. */
  actions: ReactNode;
}

/**
 * The Bank Transactions filter bar.
 *
 * Lifted out of `BankingClient`, which was 1,139 lines, and rebuilt in two
 * tiers after a reader sent a screenshot of it: seven controls in one wrapping
 * run had broken into three ragged rows that cut across unrelated groups, with
 * the result count stranded in the middle of the second one.
 *
 * The tiers answer two different questions. The first is *which lines am I
 * looking at* — which account, which status, posted where. The second is
 * *find one within those* — a word, an amount. Actions stay on the right.
 *
 * The three amount boxes are one button now. They are used occasionally and
 * were taking three permanent slots on the busiest bar in the app; behind a
 * popover they cost one, and the badge says when they are doing something.
 */
export default function BankTransactionsFilters({
  bankAccounts,
  selectedId,
  onSelectedId,
  transactionStatus,
  onTransactionStatus,
  unmatchedCount,
  postedToFilter,
  onPostedTo,
  postings,
  keyword,
  onKeyword,
  suggestionRows,
  exactAmountText,
  onExactAmount,
  minAmountText,
  onMinAmount,
  maxAmountText,
  onMaxAmount,
  onClearFind,
  hasFindFilter,
  suggestedMatchCount,
  resultCount,
  actions,
}: BankTransactionsFiltersProps) {
  const activeAmountCount =
    (exactAmountText.trim() ? 1 : 0) + (minAmountText.trim() ? 1 : 0) + (maxAmountText.trim() ? 1 : 0);

  // Recomputed as the reader types, over rows that are already narrowed —
  // a few hundred at most, so no debounce earns its complexity here.
  const options = useMemo(
    () =>
      buildSearchSuggestions(suggestionRows, keyword).map((suggestion) => ({
        value: suggestion.value,
        label: (
          <Space style={{ width: "100%", justifyContent: "space-between" }} size={12}>
            <Typography.Text ellipsis style={{ maxWidth: 300 }}>
              {suggestion.value}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {suggestion.count} line{suggestion.count === 1 ? "" : "s"}
              {suggestion.field === "reference" ? " · reference" : ""}
            </Typography.Text>
          </Space>
        ),
      })),
    [suggestionRows, keyword],
  );

  const amountFields = (
    <Space direction="vertical" size={8} style={{ width: 220 }}>
      <Input
        allowClear
        aria-label="Filter bank transactions by exact amount"
        placeholder="Exact amount"
        value={exactAmountText}
        onChange={(event) => onExactAmount(event.target.value)}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        or a range
      </Typography.Text>
      <Input
        allowClear
        aria-label="Filter bank transactions by minimum amount"
        placeholder="Min amount"
        value={minAmountText}
        onChange={(event) => onMinAmount(event.target.value)}
      />
      <Input
        allowClear
        aria-label="Filter bank transactions by maximum amount"
        placeholder="Max amount"
        value={maxAmountText}
        onChange={(event) => onMaxAmount(event.target.value)}
      />
    </Space>
  );

  return (
    <FilterBar
      resultCount={resultCount}
      actions={actions}
      ariaLabel="Bank transaction filters"
      secondary={
        <>
          <AutoComplete
            value={keyword}
            onChange={onKeyword}
            options={options}
            // The options already are the answer to what was typed; letting
            // Ant Design filter them again would drop a reference whose match
            // sits in a part of the string it does not look at.
            filterOption={false}
            style={{ width: 380 }}
            popupMatchSelectWidth={420}
          >
            <Input
              allowClear
              prefix={<SearchOutlined style={{ opacity: 0.45 }} />}
              aria-label="Search bank transactions by description or reference"
              placeholder="Search description or reference"
            />
          </AutoComplete>
          <Popover content={amountFields} title="Filter by amount" trigger="click" placement="bottomLeft">
            <Badge count={activeAmountCount} size="small" offset={[-4, 2]}>
              <Button aria-label="Filter bank transactions by amount">Amount</Button>
            </Badge>
          </Popover>
          {hasFindFilter ? <Button onClick={onClearFind}>Clear filters</Button> : null}
          {suggestedMatchCount ? (
            <Typography.Text type="secondary">
              {suggestedMatchCount} suggested match{suggestedMatchCount > 1 ? "es" : ""} in the Match column
            </Typography.Text>
          ) : null}
        </>
      }
    >
      <Select
        style={{ minWidth: 280 }}
        aria-label="Choose the bank account to review"
        value={selectedId}
        onChange={onSelectedId}
        options={[
          { value: ALL_ACCOUNTS, label: `All accounts (${bankAccounts.length})` },
          ...bankAccounts.map((account) => ({
            value: account.id,
            label: `${account.bank_name || account.account_name} · ${account.account_code} (${account.currency_code})`,
          })),
        ]}
      />
      <Select
        aria-label="Filter bank transactions by status"
        value={transactionStatus}
        onChange={onTransactionStatus}
        style={{ minWidth: 150 }}
        options={[
          { value: "all", label: "All statuses" },
          { value: "unmatched", label: `For review${unmatchedCount ? ` (${unmatchedCount})` : ""}` },
          { value: "matched", label: "Matched" },
          { value: "ignored", label: "Excluded" },
        ]}
      />
      <Select
        showSearch
        aria-label="Filter bank transactions by the account they were posted to"
        value={postedToFilter}
        onChange={onPostedTo}
        style={{ minWidth: 220 }}
        optionFilterProp="label"
        options={[
          { value: "all", label: "All accounts posted to" },
          { value: "none", label: "Not categorised yet" },
          // Only accounts these lines actually use: the whole chart here
          // would be a list of things that filter to nothing.
          ...[...new Map([...postings.values()].map((p) => [p.account_id, p])).values()]
            .sort((a, b) => a.account_code.localeCompare(b.account_code))
            .map((p) => ({
              value: p.account_id,
              label: `${p.account_code} — ${p.account_name}`,
            })),
        ]}
      />
    </FilterBar>
  );
}
