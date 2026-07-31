"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { App, Button, Input, List, Modal, Space, Spin, Typography, Upload } from "antd";
import { BugOutlined, DeleteOutlined, PaperClipOutlined } from "@ant-design/icons";
import {
  FEEDBACK_KINDS,
  feedbackKindLabel,
  type FeedbackKind,
  type FeedbackPageContext,
} from "@/lib/domain/feedback";
import {
  fileFeedbackReportAction,
  recordFeedbackAttachmentsAction,
} from "@/app/(app)/settings/feedback/actions";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import {
  attachmentStoragePath,
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_MAX_FILES,
  formatBytes,
  rejectAdditionalAttachment,
  safeAttachmentName,
} from "@/lib/domain/feedback-attachment";

/** Everything a developer needs to find the page again, gathered at open time. */
function capturePageContext(pathname: string): FeedbackPageContext {
  return {
    url: window.location.href,
    route: pathname,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export default function ReportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const pathname = usePathname();
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [description, setDescription] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const contextRef = useRef<FeedbackPageContext | null>(null);

  const capture = useCallback(async () => {
    setCapturing(true);
    try {
      // Imported on demand: the library is only needed once someone reports,
      // so it stays out of the bundle every page loads.
      const { domToPng } = await import("modern-screenshot");
      // Exclude the reporting UI itself: a screenshot of the dialog covering
      // the page is useless to whoever has to reproduce the bug.
      const CHROME = ".ant-modal-root, .ant-message, .ant-notification, [data-feedback-chrome]";
      setShot(
        await domToPng(document.body, {
          scale: 0.6,
          backgroundColor: "#ffffff",
          filter: (node) => !(node instanceof Element && node.matches(CHROME)),
        }),
      );
    } catch {
      // A failed capture must not block the report — the words matter more.
      setShot(null);
    } finally {
      setCapturing(false);
    }
  }, []);

  /**
   * Run when the dialog has finished opening rather than in an effect on
   * `open`: the page context must be read *after* the modal is on screen, and
   * setting state inside an open-effect cascades renders.
   */
  function onOpened(isOpen: boolean) {
    if (!isOpen) return;
    contextRef.current = capturePageContext(pathname);
    setKind("broken");
    setDescription("");
    setIncludeShot(true);
    setFiles([]);
    void capture();
  }

  /**
   * Files go from the browser straight into the bucket: a server action carries
   * a 1 MB body by default and an attachment may be ten times that. Storage
   * policy checks the path belongs to a report this person filed, so the upload
   * cannot happen before the report exists.
   *
   * Returns what actually landed; an upload that fails costs its file, not the
   * report — the words are worth more than the attachment.
   */
  async function uploadAttachments(reportId: string) {
    if (files.length === 0) return { stored: 0, failed: 0 };
    const sb = createSupabaseBrowserClient();
    const uploaded: {
      storage_path: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
    }[] = [];
    let failed = 0;

    for (const file of files) {
      const path = attachmentStoragePath(reportId, crypto.randomUUID(), file.type);
      const { error } = await sb.storage
        .from("feedback-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        failed += 1;
        continue;
      }
      uploaded.push({
        storage_path: path,
        file_name: safeAttachmentName(file.name),
        mime_type: file.type,
        size_bytes: file.size,
      });
    }

    if (uploaded.length === 0) return { stored: 0, failed };
    const recorded = await recordFeedbackAttachmentsAction({
      report_id: reportId,
      files: uploaded,
    });
    return {
      stored: recorded.ok ? uploaded.length : 0,
      failed: failed + (recorded.ok ? 0 : uploaded.length),
    };
  }

  async function send() {
    setSending(true);
    try {
      const res = await fileFeedbackReportAction({
        kind,
        description,
        page: contextRef.current ?? capturePageContext(pathname),
        screenshot_base64:
          includeShot && shot ? shot.replace(/^data:image\/png;base64,/, "") : null,
      });
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to send the report");
        return;
      }

      const attachments = await uploadAttachments(res.data.id);
      const parts = ["Report sent"];
      if (res.data.screenshotStored) parts.push("with the screenshot");
      if (attachments.stored > 0) {
        parts.push(
          `${attachments.stored} attachment${attachments.stored === 1 ? "" : "s"} included`,
        );
      }
      if (attachments.failed > 0) {
        message.warning(
          `${attachments.failed} attachment${attachments.failed === 1 ? "" : "s"} could not be uploaded; the report was still sent.`,
        );
      }
      message.success(`${parts.join(", ")}. Thank you.`);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      title="Report a problem"
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      destroyOnHidden
      afterOpenChange={onOpened}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space.Compact block>
          {FEEDBACK_KINDS.map((option) => (
            <Button
              key={option}
              block
              type={kind === option ? "primary" : "default"}
              onClick={() => setKind(option)}
            >
              {feedbackKindLabel(option)}
            </Button>
          ))}
        </Space.Compact>

        <div>
          <Typography.Text>What happened? (optional)</Typography.Text>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us what you expected and what you saw instead…"
            rows={4}
            maxLength={4000}
            style={{ marginTop: 6 }}
          />
        </div>

        <div>
          <Typography.Text type="secondary">
            {includeShot
              ? "Screenshot of this page will be included:"
              : "This report will be sent without a screenshot."}
          </Typography.Text>
          {includeShot ? (
            <div style={{ marginTop: 8 }}>
              {capturing ? (
                <Spin size="small" />
              ) : shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot}
                  alt="Screenshot of the current page"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 240,
                    border: "1px solid #e5e7eb",
                    borderRadius: 4,
                  }}
                />
              ) : (
                <Typography.Text type="warning">
                  The screenshot could not be captured. The report will be sent without it.
                </Typography.Text>
              )}
            </div>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <Button type="link" size="small" onClick={() => setIncludeShot((v) => !v)}>
              {includeShot ? "Don't include the screenshot" : "Include the screenshot"}
            </Button>
          </div>
        </div>

        <div>
          <Typography.Text>Attachments (optional)</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Upload
              multiple
              accept={FEEDBACK_ATTACHMENT_ACCEPT}
              fileList={[]}
              beforeUpload={(file) => {
                // Held in memory and uploaded with the report; antd must not
                // post it anywhere itself.
                const problem = rejectAdditionalAttachment(files, file);
                if (problem) {
                  message.warning(problem);
                } else {
                  setFiles((current) => [...current, file]);
                }
                return false;
              }}
            >
              <Button icon={<PaperClipOutlined />} disabled={files.length >= FEEDBACK_ATTACHMENT_MAX_FILES}>
                Add a file
              </Button>
            </Upload>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Images, PDF, CSV, spreadsheet or text. Up to {FEEDBACK_ATTACHMENT_MAX_FILES} files,
              10 MB each.
            </Typography.Text>
          </div>

          {files.length > 0 ? (
            <List
              size="small"
              style={{ marginTop: 8 }}
              bordered
              dataSource={files}
              renderItem={(file, index) => (
                <List.Item
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles((current) => current.filter((_, i) => i !== index))
                      }
                    />,
                  ]}
                >
                  <Space size="small">
                    <PaperClipOutlined />
                    <span>{file.name}</span>
                    <Typography.Text type="secondary">{formatBytes(file.size)}</Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          ) : null}
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          A screenshot or an attachment from an accounting page can show customer names and
          amounts. Both are stored privately and only staff with feedback access can open them.
        </Typography.Text>

        <Button
          type="primary"
          block
          icon={<BugOutlined />}
          loading={sending}
          onClick={send}
        >
          Send report
        </Button>
      </Space>
    </Modal>
  );
}
