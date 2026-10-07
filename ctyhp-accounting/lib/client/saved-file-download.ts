"use client";
import { savedReportDownloadUrlAction } from "@/app/(app)/reports/saved/actions";

/**
 * Download a file kept in Reports › Saved through a link that lives a minute.
 *
 * The tab is opened before the link is asked for, so a browser that blocks a
 * window opened after an await still lets it through; it is cut from this page
 * (`opener = null`). Returns the reason when the link could not be made.
 */
export async function downloadSavedFile(id: string): Promise<string | null> {
  const opened = window.open("about:blank");
  if (opened) opened.opener = null;
  let result: Awaited<ReturnType<typeof savedReportDownloadUrlAction>>;
  try {
    result = await savedReportDownloadUrlAction(id);
  } catch (error) {
    opened?.close();
    return (error instanceof Error && error.message) || "Could not prepare the download";
  }
  if (!result.ok || !result.data) {
    opened?.close();
    return result.error ?? "Could not prepare the download";
  }
  if (opened) opened.location.href = result.data.url;
  else window.location.href = result.data.url;
  return null;
}
