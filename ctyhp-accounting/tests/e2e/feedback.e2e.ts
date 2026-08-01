import { describe, expect, it } from "vitest";
import {
  fileFeedbackReport,
  listFeedbackReports,
  screenshotUrl,
  setFeedbackStatus,
} from "@/lib/services/feedback";
import {
  closeE2eSession,
  createE2eServiceClient,
  openE2eSession,
} from "./support/session";

/** 1×1 PNG — enough to prove the bucket policy and the path guard accept it. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Bypasses RLS but not triggers — the only way to prove the immutability trigger. */
function serviceClient() {
  return createE2eServiceClient();
}

describe("feedback reports over HTTPS", () => {
  it("files a report with a screenshot, moves it through the queues, and refuses illegal moves", async () => {
    const { sb, marker } = await openE2eSession();
    const admin = serviceClient();
    let reportId: string | null = null;

    try {
      const filed = await fileFeedbackReport(
        sb,
        {
          kind: "broken",
          description: `${marker} the Issue button did nothing`,
          page: {
            url: "https://ctyhp-accounting.vercel.app/invoices?report=open",
            route: "/invoices",
            title: "Invoices",
            viewport: { width: 1512, height: 982 },
          },
          screenshotBase64: PIXEL_PNG,
        },
        admin,
      );
      reportId = filed.id;
      expect(
        filed.screenshotStored,
        "the private bucket must accept a screenshot filed under the report id",
      ).toBe(true);

      const listed = await listFeedbackReports(sb);
      const mine = listed.find((r) => r.id === reportId);
      expect(mine, "a filed report must appear in the queue").toBeTruthy();
      expect(mine!.status).toBe("new");
      expect(mine!.kind).toBe("broken");
      expect(mine!.screenshot).toMatch(new RegExp(`^${reportId}/[0-9a-f-]+\\.png$`));
      expect(mine!.reporter?.email, "the queue names who filed the report").toBeTruthy();

      // A reviewer can open the screenshot through a short-lived signed link.
      const url = await screenshotUrl(sb, mine!.screenshot!);
      expect(url).toContain("feedback-screenshots");

      // What the report says is evidence. RLS has no update policy, so the
      // client cannot even attempt an edit; the service role can, and the
      // trigger stops it there.
      const edit = await admin
        .from("acc_feedback_report")
        .update({ description: "rewritten" })
        .eq("id", reportId);
      expect(edit.error?.message ?? "", "a filed report must be immutable").toMatch(
        /immutable/i,
      );

      const clientEdit = await sb
        .from("acc_feedback_report")
        .update({ status: "resolved" })
        .eq("id", reportId)
        .select("id");
      expect(
        clientEdit.data ?? [],
        "no update policy exists, so a direct client write changes nothing",
      ).toEqual([]);

      // The RPC is the one path between queues, and it enforces the same
      // transitions as lib/domain/feedback.ts.
      await setFeedbackStatus(sb, reportId, "reviewing", "Reproduced on staging");
      await expect(setFeedbackStatus(sb, reportId, "new", null)).rejects.toThrow(
        /Cannot move a report from reviewing to new/i,
      );
      await setFeedbackStatus(sb, reportId, "resolved", null);
      await expect(setFeedbackStatus(sb, reportId, "resolved", null)).rejects.toThrow(
        /already resolved/i,
      );
      // Reopening a resolved report is the one way back.
      await setFeedbackStatus(sb, reportId, "reviewing", null);

      const after = (await listFeedbackReports(sb)).find((r) => r.id === reportId);
      expect(after!.status).toBe("reviewing");
      expect(after!.triageNote).toBe("Reproduced on staging");
      expect(after!.triagedAt).toBeTruthy();

      // Every move is audited atomically by the 0058 trigger function.
      const { count } = await admin
        .from("acc_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("table_name", "acc_feedback_report")
        .eq("record_id", reportId);
      expect(count, "filing plus three moves must leave an audit trail").toBeGreaterThanOrEqual(4);
    } finally {
      if (reportId) {
        const stored = await admin
          .from("acc_feedback_report")
          .select("screenshot_path")
          .eq("id", reportId)
          .maybeSingle();
        const path = (stored.data as { screenshot_path: string | null } | null)
          ?.screenshot_path;
        if (path) await admin.storage.from("feedback-screenshots").remove([path]);
        await admin.from("acc_feedback_report").delete().eq("id", reportId);
      }
      await closeE2eSession(sb);
    }
  });
});
