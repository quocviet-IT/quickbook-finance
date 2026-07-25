import { Suspense, type ReactNode } from "react";
import ReportRouteChrome from "@/components/reports/ReportRouteChrome";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <ReportRouteChrome />
      </Suspense>
      {children}
    </>
  );
}
