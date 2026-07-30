import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FeedbackKind,
  FeedbackPageContext,
  FeedbackReport,
  FeedbackStatus,
} from "@/lib/domain/feedback";

export class FeedbackError extends Error {}

const SCREENSHOT_BUCKET = "feedback-screenshots";

const COLS =
  "id,kind,description,status,page_url,page_route,page_title,viewport_width," +
  "viewport_height,screenshot_path,reporter_id,reporter_email,triaged_by," +
  "triaged_at,triage_note,created_at,updated_at";

interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  description: string | null;
  status: FeedbackStatus;
  page_url: string;
  page_route: string;
  page_title: string;
  viewport_width: number;
  viewport_height: number;
  screenshot_path: string | null;
  reporter_id: string | null;
  reporter_email: string | null;
  triaged_by: string | null;
  triaged_at: string | null;
  triage_note: string | null;
  created_at: string;
  updated_at: string;
}

/** The stored row shaped for the domain rules and the triage table. */
export interface FeedbackReportView extends FeedbackReport {
  reporterId: string | null;
  triagedAt: string | null;
  triageNote: string | null;
}

function toView(row: FeedbackRow): FeedbackReportView {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    status: row.status,
    page: {
      url: row.page_url,
      route: row.page_route,
      title: row.page_title,
      viewport: { width: row.viewport_width, height: row.viewport_height },
    },
    reporter: { email: row.reporter_email, role: null },
    screenshot: row.screenshot_path,
    createdAt: row.created_at,
    reporterId: row.reporter_id,
    triagedAt: row.triaged_at,
    triageNote: row.triage_note,
  };
}

export interface FileFeedbackInput {
  kind: FeedbackKind;
  description: string | null;
  page: FeedbackPageContext;
  /** Base64 PNG (no data-URL prefix), or null when the reporter excluded it. */
  screenshotBase64: string | null;
}

/**
 * Insert the report, then upload the screenshot under the new report's id.
 *
 * The order matters: the storage path guard only accepts a path whose first
 * segment is an existing report, so the row has to exist first. A failed upload
 * therefore leaves a readable report without its picture rather than losing the
 * report altogether — the words are worth more than the screenshot.
 */
export async function fileFeedbackReport(
  sb: SupabaseClient,
  input: FileFeedbackInput,
  /**
   * Client used for the one-time screenshot link. The table has no update
   * policy on purpose — a reporter must not be able to touch a filed row — so
   * linking runs server-side with the service role. Omit it and the report is
   * filed without its picture.
   */
  linker?: SupabaseClient,
): Promise<{ id: string; screenshotStored: boolean }> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new FeedbackError("Your session has expired. Sign in again.");

  const { data, error } = await sb
    .from("acc_feedback_report")
    .insert({
      kind: input.kind,
      description: input.description,
      page_url: input.page.url,
      page_route: input.page.route,
      page_title: input.page.title,
      viewport_width: input.page.viewport.width,
      viewport_height: input.page.viewport.height,
      reporter_id: user.id,
    })
    .select("id")
    .single();
  if (error) throw new FeedbackError(error.message);

  const reportId = (data as { id: string }).id;
  if (!input.screenshotBase64 || !linker) {
    return { id: reportId, screenshotStored: false };
  }

  const path = `${reportId}/${crypto.randomUUID()}.png`;
  const bytes = Buffer.from(input.screenshotBase64, "base64");
  const upload = await sb.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upload.error) {
    // The report stands; only the picture is missing.
    return { id: reportId, screenshotStored: false };
  }

  // Count the affected rows: without an update policy a client write reports no
  // error and changes nothing, which is how the first version silently filed
  // reports whose stored screenshot was never referenced.
  const linked = await linker
    .from("acc_feedback_report")
    .update({ screenshot_path: path })
    .eq("id", reportId)
    .select("id");
  const stored = !linked.error && (linked.data ?? []).length === 1;
  if (!stored) {
    await linker.storage.from(SCREENSHOT_BUCKET).remove([path]);
  }
  return { id: reportId, screenshotStored: stored };
}

export async function listFeedbackReports(
  sb: SupabaseClient,
): Promise<FeedbackReportView[]> {
  const { data, error } = await sb
    .from("acc_feedback_report")
    .select(COLS)
    .order("created_at", { ascending: false });
  if (error) throw new FeedbackError(error.message);

  // reporter_email is stamped onto the row by a trigger at insert time, so the
  // queue names the reporter without needing auth.users or an admin-only RPC.
  return ((data ?? []) as unknown as FeedbackRow[]).map(toView);
}

export async function setFeedbackStatus(
  sb: SupabaseClient,
  reportId: string,
  status: FeedbackStatus,
  note: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_feedback_status", {
    p_report_id: reportId,
    p_status: status,
    p_note: note,
  });
  if (error) throw new FeedbackError(error.message);
}

/** Short-lived link so a reviewer can look at the screenshot. */
export async function screenshotUrl(
  sb: SupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data) throw new FeedbackError(error?.message ?? "Screenshot unavailable");
  return data.signedUrl;
}
