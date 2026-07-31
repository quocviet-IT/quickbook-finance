import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listFeedbackAttachments, listFeedbackReports } from "@/lib/services/feedback";
import FeedbackTriageClient from "./FeedbackTriageClient";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const sb = await createSupabaseServerClient();
  const [reports, attachments, triage] = await Promise.all([
    listFeedbackReports(sb).catch(() => []),
    listFeedbackAttachments(sb).catch(() => []),
    sb.rpc("acc_has_permission", { p_key: "feedback.triage" }),
  ]);

  return (
    <div>
      <PageHeader
        title="Feedback triage"
        description="Bug reports and suggestions filed by staff, newest first."
      />
      <FeedbackTriageClient
        initialReports={reports}
        initialAttachments={attachments}
        canTriage={triage.data === true}
      />
    </div>
  );
}
