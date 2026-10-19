"use client";
import { useCallback, useState } from "react";
import { Select } from "antd";
import SimpleReport from "@/components/reports/SimpleReport";
import StatementBody, { type PartyStatement } from "@/components/reports/StatementBody";
import { partyStatementSheet } from "@/lib/domain/ledger-report-sheets";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { vendorStatementAction } from "./actions";

interface Vendor {
  id: string;
  name: string;
}
interface Props {
  vendors: Vendor[];
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  presets: PresetContext;
}

export default function VendorStatementClient({ vendors, companyName, baseCurrency, baseDecimals, presets }: Props) {
  const [vendorId, setVendorId] = useState<string>();
  // Choosing another vendor runs the report again over the dates last run.
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(
    async (when: ReportWhen): Promise<ReportRunResult<PartyStatement>> => {
      const vendor = vendors.find((v) => v.id === vendorId);
      if (!vendor) return { ok: false, error: "Choose a vendor." };
      const r = await vendorStatementAction(vendor.id, when.from ?? when.to, when.to);
      if (!r.ok || !r.data) return { ok: false, error: r.error };
      return { ok: true, data: { partyName: vendor.name, report: r.data } };
    },
    [vendors, vendorId],
  );
  const sheet = useCallback(
    (data: PartyStatement, when: ReportWhen) =>
      partyStatementSheet("vendor", data.partyName, data.report, when, { companyName, currencyCode: baseCurrency, baseDecimals }),
    [companyName, baseCurrency, baseDecimals],
  );

  return (
    <SimpleReport<PartyStatement>
      companyName={companyName}
      title="Vendor Statement"
      currencyCode={baseCurrency}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Reading the vendor's documents…"
      refreshKey={refreshKey}
      waitFor={
        vendorId
          ? null
          : {
              title: "Choose a vendor",
              description:
                "Pick the vendor whose statement you want. It opens for this year; change the dates and Run report for another period.",
            }
      }
      filters={
        <Select
          showSearch
          style={{ width: 280 }}
          placeholder="Vendor"
          aria-label="Vendor"
          optionFilterProp="label"
          value={vendorId}
          options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          onChange={(id) => {
            if (vendorId) setRefreshKey((key) => key + 1);
            setVendorId(id);
          }}
        />
      }
      render={(data, _when, { printing }) => (
        <StatementBody kind="vendor" data={data} currencyCode={baseCurrency} decimals={baseDecimals} printing={printing} />
      )}
    />
  );
}
