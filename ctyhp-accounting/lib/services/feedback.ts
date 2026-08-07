import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FeedbackFrequency,
  FeedbackImpact,
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
  /**
   * The improvement argument. Null on a fault report — a broken screen needs
   * reproducing, not ranking.
   */
  current_difficulty?: string | null;
  desired_outcome?: string | null;
  impact?: FeedbackImpact | null;
  frequency?: FeedbackFrequency | null;
  /** What the screen is for, taken from the guide when the report was filed. */
  page_purpose?: string | null;
}

/**
 * Insert the report, then upload the screenshot under the new report's id.
 *
 * The order matters: the storage path guard only accepts a path whose first
 * segment is an existing report, so the row has to exist first. A failed upload
 * therefore leaves a readable report without its picture rather than losing the
 * report altogether — the words are worth more than the screenshot.
 *
 * When the picture does not make it, the reason comes back with the id.
 * Returning only `screenshotStored: false` is what let four reports arrive with
 * no screenshot while everyone believed one had been attached.
 */
export interface FiledFeedbackReport {
  id: string;
  screenshotStored: boolean;
  /** Set only when a screenshot was offered and did not make it. */
  screenshotProblem?: string;
}

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
): Promise<FiledFeedbackReport> {
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
      // What is hard now, what better looks like, and what it costs to leave
      // alone. Null on a fault report — those fields belong to a suggestion.
      current_difficulty: input.current_difficulty || null,
      desired_outcome: input.desired_outcome || null,
      impact: input.impact ?? null,
      frequency: input.frequency ?? null,
      page_purpose: input.page_purpose || null,
    })
    .select("id")
    .single();
  if (error) throw new FeedbackError(error.message);

  const reportId = (data as { id: string }).id;
  if (!input.screenshotBase64) return { id: reportId, screenshotStored: false };
  if (!linker) {
    return {
      id: reportId,
      screenshotStored: false,
      screenshotProblem: "This deployment cannot store screenshots.",
    };
  }

  const path = `${reportId}/${crypto.randomUUID()}.png`;
  const bytes = Buffer.from(input.screenshotBase64, "base64");
  const upload = await sb.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upload.error) {
    // The report stands; only the picture is missing — and the reporter is told
    // so, because a screenshot they think they sent is worse than none.
    return { id: reportId, screenshotStored: false, screenshotProblem: upload.error.message };
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
    return {
      id: reportId,
      screenshotStored: false,
      screenshotProblem:
        linked.error?.message ?? "The screenshot was uploaded but could not be linked to the report.",
    };
  }
  return { id: reportId, screenshotStored: true };
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

/**
 * The improvement argument behind each suggestion, with the priority the
 * database computed for it.
 *
 * Read through `acc_feedback_queue` rather than the table so the score comes
 * from `acc_feedback_priority` (migration 0086) and nowhere else — a second
 * copy of the ranking in TypeScript would drift from the one every other reader
 * sees. The screen still gets page, screenshot and triage detail from
 * `listFeedbackReports`; the two are joined by id.
 */
export interface FeedbackImprovementView {
  id: string;
  priority: number;
  currentDifficulty: string | null;
  desiredOutcome: string | null;
  impact: FeedbackImpact | null;
  frequency: FeedbackFrequency | null;
  pagePurpose: string | null;
}

interface FeedbackQueueRow {
  id: string;
  priority: number;
  current_difficulty: string | null;
  desired_outcome: string | null;
  impact: FeedbackImpact | null;
  frequency: FeedbackFrequency | null;
  page_purpose: string | null;
}

export async function listFeedbackImprovements(
  sb: SupabaseClient,
): Promise<FeedbackImprovementView[]> {
  const { data, error } = await sb.rpc("acc_feedback_queue", { p_status: null });
  if (error) throw new FeedbackError(error.message);
  return ((data ?? []) as FeedbackQueueRow[]).map((row) => ({
    id: row.id,
    priority: row.priority,
    currentDifficulty: row.current_difficulty,
    desiredOutcome: row.desired_outcome,
    impact: row.impact,
    frequency: row.frequency,
    pagePurpose: row.page_purpose,
  }));
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

// --- Attachments (migration 0070) ---

const ATTACHMENT_BUCKET = "feedback-attachments";

export interface FeedbackAttachmentView {
  id: string;
  reportId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface RecordAttachmentInput {
  reportId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Record files the reporter has already uploaded to the bucket.
 *
 * The bytes travel from the browser straight to storage — a server action
 * carries a 1 MB body by default, and an attachment is allowed ten times that.
 * What reaches the server is the path, and RLS on both the object and this
 * table checks the report belongs to the caller.
 */
export async function recordFeedbackAttachments(
  sb: SupabaseClient,
  inputs: readonly RecordAttachmentInput[],
): Promise<FeedbackAttachmentView[]> {
  if (inputs.length === 0) return [];
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new FeedbackError("Your session has expired. Sign in again.");

  const { data, error } = await sb
    .from("acc_feedback_attachment")
    .insert(
      inputs.map((input) => ({
        report_id: input.reportId,
        storage_path: input.storagePath,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        uploaded_by: user.id,
      })),
    )
    .select("id,report_id,storage_path,file_name,mime_type,size_bytes,created_at");
  if (error) throw new FeedbackError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toAttachmentView);
}

function toAttachmentView(row: Record<string, unknown>): FeedbackAttachmentView {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    storagePath: row.storage_path as string,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at as string,
  };
}

/** Every attachment on the reports the caller may read, newest report first. */
export async function listFeedbackAttachments(
  sb: SupabaseClient,
): Promise<FeedbackAttachmentView[]> {
  const { data, error } = await sb
    .from("acc_feedback_attachment")
    .select("id,report_id,storage_path,file_name,mime_type,size_bytes,created_at")
    .order("created_at");
  if (error) throw new FeedbackError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toAttachmentView);
}

/** Short-lived link so a reviewer can open one attachment. */
export async function attachmentUrl(sb: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await sb.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new FeedbackError(error?.message ?? "Attachment unavailable");
  return data.signedUrl;
}
