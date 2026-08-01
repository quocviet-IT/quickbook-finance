import { describe, expect, it } from "vitest";
import {
  attachmentUrl,
  fileFeedbackReport,
  listFeedbackAttachments,
  recordFeedbackAttachments,
} from "@/lib/services/feedback";
import { attachmentStoragePath } from "@/lib/domain/feedback-attachment";
import {
  closeE2eSession,
  createE2eServiceClient,
  openE2eSession,
} from "./support/session";

const BUCKET = "feedback-attachments";

/** A real, if tiny, PDF — enough for the bucket's mime check to be meaningful. */
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

function serviceClient() {
  return createE2eServiceClient();
}

/**
 * A reporter uploads straight to the bucket, so the policies are the whole
 * control. This proves what they allow and what they refuse, on the live
 * project, then removes everything it created.
 */
describe("feedback attachments over HTTPS", () => {
  it("accepts a file on your own report and refuses one that is not", async () => {
    const { sb, marker } = await openE2eSession();
    const admin = serviceClient();
    let reportId: string | null = null;
    const objectPaths: string[] = [];

    try {
      const filed = await fileFeedbackReport(sb, {
        kind: "suggestion",
        description: `${marker} the vendor's PDF disagrees with the bill`,
        page: {
          url: "https://ctyhp-accounting.vercel.app/bills",
          route: "/bills",
          title: "Bills",
          viewport: { width: 1512, height: 982 },
        },
        screenshotBase64: null,
      });
      reportId = filed.id;

      // 1. A PDF on the reporter's own report: accepted by the path guard and
      //    by the bucket's mime list.
      const path = attachmentStoragePath(reportId, crypto.randomUUID(), "application/pdf");
      const upload = await sb.storage
        .from(BUCKET)
        .upload(path, PDF_BYTES, { contentType: "application/pdf", upsert: false });
      expect(upload.error, upload.error?.message).toBeNull();
      objectPaths.push(path);

      const recorded = await recordFeedbackAttachments(sb, [
        {
          reportId,
          storagePath: path,
          fileName: "vendor-bill.pdf",
          mimeType: "application/pdf",
          sizeBytes: PDF_BYTES.byteLength,
        },
      ]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].fileName).toBe("vendor-bill.pdf");

      // 2. It reads back on the report, and opens through a signed link.
      const listed = await listFeedbackAttachments(sb);
      const mine = listed.filter((row) => row.reportId === reportId);
      expect(mine).toHaveLength(1);

      const url = await attachmentUrl(sb, path);
      const fetched = await fetch(url);
      expect(fetched.status, "a signed link must open the file").toBe(200);

      // 3. A path under a report that does not exist is refused: an attachment
      //    can only belong to a report somebody actually filed.
      const orphan = attachmentStoragePath(
        crypto.randomUUID(),
        crypto.randomUUID(),
        "application/pdf",
      );
      const orphanUpload = await sb.storage
        .from(BUCKET)
        .upload(orphan, PDF_BYTES, { contentType: "application/pdf" });
      expect(orphanUpload.error, "an attachment with no report must be refused").not.toBeNull();

      // 4. A file type outside the list is refused by the bucket itself.
      const script = `${reportId}/${crypto.randomUUID()}.js`;
      const scriptUpload = await sb.storage
        .from(BUCKET)
        .upload(script, Buffer.from("alert(1)", "utf8"), { contentType: "text/javascript" });
      expect(scriptUpload.error, "an executable must be refused").not.toBeNull();

      // 5. What a report shows cannot change: there is no update or delete
      //    policy on the attachment table for a client session.
      const removal = await sb
        .from("acc_feedback_attachment")
        .delete()
        .eq("id", recorded[0].id)
        .select("id");
      expect(removal.data ?? [], "a client must not be able to unsay an attachment").toHaveLength(
        0,
      );
    } finally {
      if (objectPaths.length) await admin.storage.from(BUCKET).remove(objectPaths);
      if (reportId) await admin.from("acc_feedback_report").delete().eq("id", reportId);
      await closeE2eSession(sb);
    }
  });
});
