/**
 * What may be attached to a feedback report.
 *
 * Pure. The same list the storage bucket enforces, in a form the dialog can
 * check before a byte is uploaded and the server can check again before a row
 * is written — a client that lies about a file's type must not get past the
 * second check.
 */

export const FEEDBACK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const FEEDBACK_ATTACHMENT_MAX_FILES = 5;

/** mime type → the extension the storage path is allowed to end in. */
export const FEEDBACK_ATTACHMENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** For the file picker's `accept`, so the browser dialog offers the right files. */
export const FEEDBACK_ATTACHMENT_ACCEPT = Object.keys(FEEDBACK_ATTACHMENT_TYPES).join(",");

export function isAllowedAttachmentType(mimeType: string): boolean {
  return Object.hasOwn(FEEDBACK_ATTACHMENT_TYPES, mimeType);
}

export function attachmentExtension(mimeType: string): string | null {
  return FEEDBACK_ATTACHMENT_TYPES[mimeType] ?? null;
}

export interface AttachmentCandidate {
  name: string;
  type: string;
  size: number;
}

/**
 * Why a file cannot be attached, or null when it can. One sentence, addressed
 * to the person who picked it.
 */
export function rejectAttachment(file: AttachmentCandidate): string | null {
  if (!isAllowedAttachmentType(file.type)) {
    return `${file.name || "That file"} is not a type we accept — send an image, a PDF, a CSV, a spreadsheet, or a text file.`;
  }
  if (file.size <= 0) {
    return `${file.name} is empty.`;
  }
  if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(FEEDBACK_ATTACHMENT_MAX_BYTES)}.`;
  }
  return null;
}

/** Whether one more file still fits, given what is already selected. */
export function rejectAdditionalAttachment(
  existing: readonly AttachmentCandidate[],
  file: AttachmentCandidate,
): string | null {
  if (existing.length >= FEEDBACK_ATTACHMENT_MAX_FILES) {
    return `A report takes at most ${FEEDBACK_ATTACHMENT_MAX_FILES} attachments.`;
  }
  return rejectAttachment(file);
}

/** `2.4 MB`, `812 KB`, `48 bytes` — enough precision to argue with a limit. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The object path for a file on a report: `<report id>/<uuid>.<ext>`, the shape
 * the storage policy accepts. The caller supplies the uuid so the path can be
 * generated where randomness is available and tested where it is not.
 */
export function attachmentStoragePath(
  reportId: string,
  objectId: string,
  mimeType: string,
): string {
  const extension = attachmentExtension(mimeType);
  if (!extension) throw new Error(`Unsupported attachment type: ${mimeType}`);
  return `${reportId}/${objectId}.${extension}`;
}

/** A stored name never longer than the column allows, and never empty. */
export function safeAttachmentName(name: string): string {
  const trimmed = name.trim().replace(/[\r\n\t]/g, " ");
  if (trimmed.length === 0) return "attachment";
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

export function attachmentIsImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
