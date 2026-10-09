"use client";

import { useCallback, useState } from "react";
import { Alert, Button, Empty, Segmented } from "antd";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn } from "@/components/ui/columns";
import ProofLine from "@/components/reports/ProofLine";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import RecordTaxPaymentModal, { type TaxPaymentAccountOption, type TaxPaymentPrefill } from "@/components/sales-tax/RecordTaxPaymentModal";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import {
  DEFAULT_GRANULARITY,
  GRANULARITIES,
  NOTHING_OUTSTANDING,
  NO_TAX_ACCOUNT_HINT,
  NO_TAX_ACCOUNT_TITLE,
  OPENING_ROW_LABEL,
  SALES_TAX_FOOTNOTE,
  SALES_TAX_FOOTNOTE_TITLE,
  buildSalesTaxLiability,
  formatRate,
  overpaidNote,
  owedAtLabel,
  paymentButtonLabel,
  salesTaxLiabilitySheet,
  unlinkedWarning,
  type Granularity,
  type SalesTaxLiabilityData,
  type TaxPeriodRow,
} from "@/lib/domain/sales-tax-liability";

const PAGE_SIZE = 50;

/** A row of the period table: a period, or the opening row, which has only its owed figure. */
type TableRow = Partial<TaxPeriodRow> & { key: string; label: string; owedMinor: number; opening?: boolean };

/**
 * Sales Tax Liability: what was charged and what was paid over, by month,
 * quarter or fiscal year, with what is still owed after each. Read from the
 * entries on the tax accounts, so credit memos and imported books are counted.
 */
export default function SalesTaxLiabilityClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
  canWrite,
  taxPayableAccounts,
  bankAccounts,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<SalesTaxLiabilityData>>;
  canWrite: boolean;
  taxPayableAccounts: TaxPaymentAccountOption[];
  bankAccounts: TaxPaymentAccountOption[];
}) {
  const [granularity, setGranularity] = useState<Granularity>(DEFAULT_GRANULARITY);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [payOpen, setPayOpen] = useState(false);
  const [prefill, setPrefill] = useState<TaxPaymentPrefill | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (data: SalesTaxLiabilityData) => salesTaxLiabilitySheet(buildSalesTaxLiability(data, granularity), { companyName, currencyCode, money }),
    [companyName, currencyCode, money, granularity],
  );
  const moneyCell = (minor: number | undefined) =>
    minor === undefined ? "" : <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>;

  return (
    <>
      <SimpleReport<SalesTaxLiabilityData>
        companyName={companyName}
        title="Sales Tax Liability"
        currencyCode={currencyCode}
        period={{ kind: "range", ctx: presets, preset: "year" }}
        load={load}
        sheet={sheet}
        refreshKey={refreshKey}
        runningText="Adding up the sales tax…"
        filters={
          <Segmented<Granularity>
            aria-label="Period size"
            value={granularity}
            onChange={setGranularity}
            options={GRANULARITIES.map((g) => ({ value: g.value, label: g.label }))}
          />
        }
        render={(data, _when, { printing }) => {
          if (data.basis === "none") {
            return (
              <Empty
                description={
                  <>
                    <strong>{NO_TAX_ACCOUNT_TITLE}</strong>
                    <div className={styles.muted}>{NO_TAX_ACCOUNT_HINT}</div>
                  </>
                }
              />
            );
          }
          const report = buildSalesTaxLiability(data, granularity);
          const warning = unlinkedWarning(report.unlinked);
          const showAdjustments = report.total.adjustmentMinor !== 0;
          const rows: TableRow[] = [
            ...(report.openingMinor !== 0 ? [{ key: "opening", label: OPENING_ROW_LABEL, owedMinor: report.openingMinor, opening: true }] : []),
            ...report.periods,
          ];
          const owed = report.owedAtEndMinor;

          return (
            <>
              <StatRow
                items={[
                  { label: "Collected", value: money(report.collectedMinor) },
                  { label: "Paid over", value: money(report.paidMinor) },
                  { label: owedAtLabel(report), value: money(owed), danger: owed !== 0 },
                  { label: "Effective rate", value: formatRate(report.effectiveRatePercent) },
                ]}
              />

              {warning ? <Alert type="warning" showIcon title={warning} style={{ marginBottom: 16 }} /> : null}

              <ReportTable<TableRow>
                rowKey={(row) => row.key}
                dataSource={rows}
                pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
                emptyTitle="No periods to show"
                summary={() => (
                  <SummaryRow>
                    <SummaryCell index={0}>
                      <b>Total</b>
                    </SummaryCell>
                    <SummaryCell index={1} align="right">
                      <b>{money(report.total.grossMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={2} align="right">
                      <b>{money(report.total.taxableMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={3} align="right">
                      <b>{money(report.total.exemptMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={4} align="right" />
                    <SummaryCell index={5} align="right">
                      <b>{money(report.total.collectedMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={6} align="right">
                      <b>{money(report.total.paidMinor)}</b>
                    </SummaryCell>
                    {showAdjustments ? (
                      <SummaryCell index={7} align="right">
                        <b>{money(report.total.adjustmentMinor)}</b>
                      </SummaryCell>
                    ) : null}
                    <SummaryCell index={showAdjustments ? 8 : 7} align="right">
                      <b>{money(report.total.owedMinor)}</b>
                    </SummaryCell>
                  </SummaryRow>
                )}
                columns={[
                  flexColumn<TableRow>({
                    title: "Period",
                    key: "period",
                    render: (_: unknown, row: TableRow) => (row.opening ? <span className={styles.muted}>{row.label}</span> : row.label),
                  }),
                  { title: "Gross sales", dataIndex: "grossMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Taxable", dataIndex: "taxableMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Exempt", dataIndex: "exemptMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Rate",
                    dataIndex: "ratePercent",
                    width: COLUMN.QTY,
                    align: "right",
                    render: (value: number | null | undefined) => (value === undefined ? "" : <span className={styles.muted}>{formatRate(value)}</span>),
                  },
                  { title: "Tax collected", dataIndex: "collectedMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Paid over", dataIndex: "paidMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  ...(showAdjustments
                    ? [{ title: "Adjustments", dataIndex: "adjustmentMinor", width: COLUMN.MONEY_WIDE, align: "right" as const, render: moneyCell }]
                    : []),
                  { title: "Owed at period end", dataIndex: "owedMinor", width: COLUMN.MONEY_WIDE + 20, align: "right", render: moneyCell },
                ]}
              />
              <ProofLine
                against={`the tax accounts’ ledger balance on ${report.to}`}
                tie={report.proof}
                money={money}
                whenOut={
                  <>The figure owed is worked out from the entries on the tax accounts, so a gap points to an entry dated outside the range or one the report could not read.</>
                }
              />

              {!printing ? (
                <div style={{ marginTop: 16 }}>
                  {owed > 0 ? (
                    canWrite ? (
                      <Button
                        type="primary"
                        onClick={() => {
                          setPrefill({ amountMinor: owed, from: report.from, to: report.to });
                          setPayOpen(true);
                        }}
                      >
                        {paymentButtonLabel(money(owed))}
                      </Button>
                    ) : null
                  ) : (
                    <span className={styles.muted}>{owed < 0 ? overpaidNote(money(-owed)) : NOTHING_OUTSTANDING}</span>
                  )}
                </div>
              ) : null}

              <ReportFoot>
                <strong>{SALES_TAX_FOOTNOTE_TITLE}</strong> {SALES_TAX_FOOTNOTE}
              </ReportFoot>
            </>
          );
        }}
      />
      <RecordTaxPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onRecorded={() => setRefreshKey((k) => k + 1)}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
        baseCurrency={currencyCode}
        decimals={decimals}
        prefill={prefill}
      />
    </>
  );
}
