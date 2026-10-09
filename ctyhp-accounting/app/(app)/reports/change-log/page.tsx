import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/PageStates";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { currentAccess } from "@/lib/db/settings-access";
import { CHANGE_LOG_PERMISSIONS } from "@/lib/domain/report-catalog";
import { canShowNavItem } from "@/lib/domain/navigation";
import { reportPageContext } from "@/lib/services/report-context";
import ChangeLogClient from "./ChangeLogClient";
import { changeLogAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChangeLogPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, access] = await Promise.all([reportPageContext(sb), currentAccess()]);
  // Fails closed: an unread permission list is not a yes here, unlike in the sidebar.
  const allowed =
    access.role !== null &&
    canShowNavItem({ anyPermissions: [...CHANGE_LOG_PERMISSIONS] }, { role: access.role, permissionKeys: access.permissionKeys ?? [] });
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Change Log"
        description="What changed in the books, when, and by whom — from the audit log."
      />
      {allowed ? (
        <ChangeLogClient
          companyName={ctx.companyName}
          currencyCode={ctx.currencyCode}
          presets={ctx.presets}
          timeZone={ctx.timeZone}
          load={changeLogAction}
        />
      ) : (
        <EmptyState
          title="This report reads the audit log"
          description="Your role cannot read the audit log. An administrator can give your role that permission under Settings › Permissions."
        />
      )}
    </div>
  );
}
