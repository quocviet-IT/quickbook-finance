"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from "@/lib/domain/feedback";
import type { FeedbackKind, FeedbackStatus } from "@/lib/domain/feedback";
import {
  attachmentUrl,
  fileFeedbackReport,
  listFeedbackAttachments,
  listFeedbackImprovements,
  listFeedbackReports,
  recordFeedbackAttachments,
  screenshotUrl,
  setFeedbackStatus,
  FeedbackError,
  type FeedbackAttachmentView,
  type FeedbackImprovementView,
  type FeedbackReportView,
} from "@/lib/services/feedback";
import {
  feedbackAttachmentsSchema,
  feedbackReportSchema,
  feedbackStatusChangeSchema,
} from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  if (err instanceof FeedbackError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

/**
 * Filing is open to anyone signed in — a tester who cannot report a bug simply
 * will not report it. The database records who filed it.
 */
export async function fileFeedbackReportAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; screenshotStored: boolean }>> {
  const parsed = feedbackReportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report" };
  }
  try {
    const sb = await createSupabaseServerClient();
    // The reporter's own client inserts the row; the screenshot link is a
    // server-side write, because the table deliberately has no update policy.
    const result = await fileFeedbackReport(
      sb,
      {
        kind: parsed.data.kind as FeedbackKind,
        description: parsed.data.description || null,
        page: parsed.data.page,
        screenshotBase64: parsed.data.screenshot_base64 || null,
        // A fault report carries none of these; the dialog only asks for them
        // when the reporter is proposing something, and the answer is dropped
        // here if they then switch back, so a "broken" row cannot arrive
        // ranked.
        current_difficulty:
          parsed.data.kind === "suggestion" ? parsed.data.current_difficulty || null : null,
        desired_outcome:
          parsed.data.kind === "suggestion" ? parsed.data.desired_outcome || null : null,
        impact: parsed.data.kind === "suggestion" ? parsed.data.impact ?? null : null,
        frequency: parsed.data.kind === "suggestion" ? parsed.data.frequency ?? null : null,
        page_purpose: parsed.data.page_purpose || null,
      },
      parsed.data.screenshot_base64 ? createSupabaseAutomationClient() : undefined,
    );
    revalidatePath("/settings/feedback");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function listFeedbackReportsAction(): Promise<
  ActionResult<FeedbackReportView[]>
> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listFeedbackReports(sb) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function listFeedbackImprovementsAction(): Promise<
  ActionResult<FeedbackImprovementView[]>
> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listFeedbackImprovements(sb) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function setFeedbackStatusAction(
  raw: unknown,
): Promise<ActionResult> {
  const parsed = feedbackStatusChangeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid status change" };
  }
  try {
    const sb = await createSupabaseServerClient();
    // The RPC checks feedback.triage and the legal transitions; it is the only
    // path that can move a report between queues.
    await setFeedbackStatus(
      sb,
      parsed.data.report_id,
      parsed.data.status as FeedbackStatus,
      parsed.data.note || null,
    );
    revalidatePath("/settings/feedback");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Record attachments the browser has already uploaded. The type and size are
 * checked again here: the bucket enforces them too, but a client that lies
 * about a file must not be able to write a row that says otherwise.
 */
export async function recordFeedbackAttachmentsAction(
  raw: unknown,
): Promise<ActionResult<FeedbackAttachmentView[]>> {
  const parsed = feedbackAttachmentsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid attachment" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const stored = await recordFeedbackAttachments(
      sb,
      parsed.data.files.map((file) => ({
        reportId: parsed.data.report_id,
        storagePath: file.storage_path,
        fileName: file.file_name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
      })),
    );
    revalidatePath("/settings/feedback");
    return { ok: true, data: stored };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function listFeedbackAttachmentsAction(): Promise<
  ActionResult<FeedbackAttachmentView[]>
> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listFeedbackAttachments(sb) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function feedbackAttachmentUrlAction(
  path: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { url: await attachmentUrl(sb, path) } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function feedbackScreenshotUrlAction(
  path: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { url: await screenshotUrl(sb, path) } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Exposed so the client can render tabs and menus without re-declaring them. */
export async function feedbackVocabularyAction(): Promise<
  ActionResult<{ kinds: readonly string[]; statuses: readonly string[] }>
> {
  return { ok: true, data: { kinds: FEEDBACK_KINDS, statuses: FEEDBACK_STATUSES } };
}
