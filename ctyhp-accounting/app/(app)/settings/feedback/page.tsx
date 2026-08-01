import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  listFeedbackAttachments,
  listFeedbackImprovements,
  listFeedbackReports,
} from "@/lib/services/feedback";
import FeedbackTriageClient from "./FeedbackTriageClient";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const sb = await createSupabaseServerClient();
  const [reports, attachments, improvements, triage] = await Promise.all([
    listFeedbackReports(sb).catch(() => []),
    listFeedbackAttachments(sb).catch(() => []),
    listFeedbackImprovements(sb).catch(() => []),
    sb.rpc("acc_has_permission", { p_key: "feedback.triage" }),
  ]);

  return (
    <div>
      <PageHeader
        title="Feedback triage"
        description="What staff report as broken and what they ask for. Sort by urgency to see what is costing the most time."
      />
      <FeedbackTriageClient
        initialReports={reports}
        initialAttachments={attachments}
        initialImprovements={improvements}
        canTriage={triage.data === true}
      />
    </div>
  );
}
