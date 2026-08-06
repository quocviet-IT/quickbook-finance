import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  listFeedbackAttachments,
  listFeedbackImprovements,
  listFeedbackReports,
} from "@/lib/services/feedback";
import FeedbackTriageClient from "./FeedbackTriageClient";
import MyReportsClient from "./MyReportsClient";

export const dynamic = "force-dynamic";

/**
 * Two screens on one route, and no guard in front of them.
 *
 * An administrator triages the whole queue. Everyone else comes here to see the
 * reports they filed, which is why requireSettingsAccess is deliberately absent
 * from this page alone: the narrowing belongs to RLS, and since 0099 it is exact.
 */
export default async function FeedbackPage() {
  const sb = await createSupabaseServerClient();
  const [reports, attachments, read, triage] = await Promise.all([
    listFeedbackReports(sb).catch(() => []),
    listFeedbackAttachments(sb).catch(() => []),
    sb.rpc("acc_has_permission", { p_key: "feedback.read" }),
    sb.rpc("acc_has_permission", { p_key: "feedback.triage" }),
  ]);
  const canRead = read.data === true;

  if (!canRead) {
    return (
      <div>
        <PageHeader
          title="My reports"
          description="The bug reports and suggestions you filed, and where each one stands."
        />
        <MyReportsClient reports={reports} attachments={attachments} />
      </div>
    );
  }

  // acc_feedback_queue filters on feedback.read alone and returns nothing to
  // anyone else, so it is only ever asked for by someone who holds it.
  const improvements = await listFeedbackImprovements(sb).catch(() => []);

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
