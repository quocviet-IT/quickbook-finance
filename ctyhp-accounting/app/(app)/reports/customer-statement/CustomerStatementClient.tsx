"use client";
import { useCallback, useState } from "react";
import { Select } from "antd";
import SimpleReport from "@/components/reports/SimpleReport";
import StatementBody, { type PartyStatement } from "@/components/reports/StatementBody";
import { partyStatementSheet } from "@/lib/domain/ledger-report-sheets";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { customerStatementAction } from "./actions";

interface Customer {
  id: string;
  name: string;
}
interface Props {
  customers: Customer[];
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  presets: PresetContext;
  /** How to pay (2.83): under the statement, and in its PDF. */
  payNote: string | null;
}

export default function CustomerStatementClient({ customers, companyName, baseCurrency, baseDecimals, presets, payNote }: Props) {
  const [customerId, setCustomerId] = useState<string>();
  // Choosing another customer runs the report again over the dates last run.
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(
    async (when: ReportWhen): Promise<ReportRunResult<PartyStatement>> => {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return { ok: false, error: "Choose a customer." };
      const r = await customerStatementAction(customer.id, when.from ?? when.to, when.to);
      if (!r.ok || !r.data) return { ok: false, error: r.error };
      return { ok: true, data: { partyName: customer.name, report: r.data } };
    },
    [customers, customerId],
  );
  const sheet = useCallback(
    (data: PartyStatement, when: ReportWhen) =>
      partyStatementSheet("customer", data.partyName, data.report, when, { companyName, currencyCode: baseCurrency, baseDecimals }, payNote),
    [companyName, baseCurrency, baseDecimals, payNote],
  );

  return (
    <SimpleReport<PartyStatement>
      companyName={companyName}
      title="Customer Statement"
      currencyCode={baseCurrency}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Reading the customer's documents…"
      refreshKey={refreshKey}
      waitFor={
        customerId
          ? null
          : {
              title: "Choose a customer",
              description:
                "Pick the customer whose statement you want. It opens for this year; change the dates and Run report for another period.",
            }
      }
      filters={
        <Select
          showSearch
          style={{ width: 280 }}
          placeholder="Customer"
          aria-label="Customer"
          optionFilterProp="label"
          value={customerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(id) => {
            if (customerId) setRefreshKey((key) => key + 1);
            setCustomerId(id);
          }}
        />
      }
      render={(data, _when, { printing }) => (
        <StatementBody
          kind="customer"
          data={data}
          currencyCode={baseCurrency}
          decimals={baseDecimals}
          printing={printing}
          payNote={payNote}
        />
      )}
    />
  );
}
