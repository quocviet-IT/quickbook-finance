"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LeftOutlined } from "@ant-design/icons";
import { usePathname, useSearchParams } from "next/navigation";
import {
  findReportByLocation,
  getReportGroup,
} from "@/lib/domain/report-catalog";
import { recordRecentReport } from "@/lib/client/report-preferences";
import { ReportAudienceToggle } from "@/components/reports/ReportAudience";

export default function ReportRouteChrome() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportParam = searchParams.get("report");
  const report = findReportByLocation(pathname, reportParam);

  useEffect(() => {
    if (report) recordRecentReport(report.id);
  }, [report]);

  if (pathname === "/reports" || !report) return null;

  const group = getReportGroup(report.group);

  return (
    <nav className="report-route-chrome" aria-label="Reports navigation">
      <Link href="/reports" className="report-route-chrome__back">
        <LeftOutlined aria-hidden="true" /> Report Center
      </Link>
      <span className="report-route-chrome__context">
        {group?.label} · {report.title}
      </span>
      <ReportAudienceToggle />
    </nav>
  );
}
