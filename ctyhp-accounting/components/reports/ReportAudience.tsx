"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Segmented, Tooltip } from "antd";
import {
  getReportAudience,
  reportAudienceServerSnapshot,
  setReportAudience,
  subscribeReportAudience,
  type ReportAudience,
} from "@/lib/client/report-audience";

export function useReportAudience(): ReportAudience {
  return useSyncExternalStore(
    subscribeReportAudience,
    getReportAudience,
    reportAudienceServerSnapshot,
  );
}

/**
 * Who is reading. The choice sticks across every report and every page, so a
 * bookkeeper never has to scroll past a chart again and a manager never has to
 * hunt for one.
 */
export function ReportAudienceToggle() {
  const audience = useReportAudience();
  return (
    <Tooltip title="Accountant puts the figures first; Management leads with the charts.">
      <Segmented
        size="small"
        aria-label="Report view"
        value={audience}
        onChange={(value) => setReportAudience(value as ReportAudience)}
        options={[
          { label: "Accountant", value: "accountant" },
          { label: "Management", value: "management" },
        ]}
      />
    </Tooltip>
  );
}

/**
 * A report's two halves in the order its reader wants them: figures first for
 * an accountant, charts first for management. One implementation, so no report
 * can drift into its own idea of the order.
 */
export function ReportBody({ numbers, chart }: { numbers: ReactNode; chart: ReactNode }) {
  const audience = useReportAudience();
  if (audience === "management") {
    return (
      <>
        {chart}
        <div style={{ marginTop: 24 }}>{numbers}</div>
      </>
    );
  }
  return (
    <>
      {numbers}
      <div style={{ marginTop: 24 }}>{chart}</div>
    </>
  );
}
