"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { App, Alert, Button, Input, List, Modal, Radio, Space, Spin, Typography, Upload } from "antd";
import { BugOutlined, DeleteOutlined, PaperClipOutlined } from "@ant-design/icons";
import {
  FEEDBACK_FREQUENCIES,
  FEEDBACK_IMPACTS,
  FEEDBACK_KINDS,
  feedbackFrequencyLabel,
  feedbackImpactLabel,
  feedbackKindLabel,
  type FeedbackFrequency,
  type FeedbackImpact,
  type FeedbackKind,
  type FeedbackPageContext,
} from "@/lib/domain/feedback";
import { screenContextFor } from "@/lib/domain/screen-context";
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
  // The improvement argument, asked for only when somebody is proposing one.
  const [difficulty, setDifficulty] = useState("");
  const [outcome, setOutcome] = useState("");
  const [impact, setImpact] = useState<FeedbackImpact | null>(null);
  const [frequency, setFrequency] = useState<FeedbackFrequency | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const contextRef = useRef<FeedbackPageContext | null>(null);
  const screen = screenContextFor(pathname);

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
    setDifficulty("");
    setOutcome("");
    setImpact(null);
    setFrequency(null);
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
        current_difficulty: difficulty,
        desired_outcome: outcome,
        impact,
        frequency,
        // What this screen is for, from the guide. Recorded so whoever reads the
        // queue knows which part of the system an idea belongs to without
        // opening it — and so a route that gets renamed later still reads.
        page_purpose: screen.summary ?? null,
      });
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to send the report");
        return;
      }

      const attachments = await uploadAttachments(res.data.id);
      const parts = [kind === "broken" ? "Report sent" : "Suggestion sent"];
      if (res.data.screenshotStored) parts.push("with the screenshot");
      // Silence here is what made this worth fixing: the reporter watched the
      // screenshot being captured and had no way to learn it never arrived.
      if (res.data.screenshotProblem) {
        message.warning(
          `The report was sent, but the screenshot could not be stored: ${res.data.screenshotProblem}`,
          8,
        );
      }
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
      title={kind === "broken" ? "Report a problem" : "Suggest an improvement"}
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

        {/* Say which screen this is about, so nobody has to describe it. */}
        {screen.summary ? (
          <Alert type="info" showIcon message={`About this screen: ${screen.summary}`} />
        ) : null}

        {kind === "broken" ? (
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
        ) : (
          <>
            {/*
              A suggestion is an argument, not a fault report. Asked as three
              separate questions because the third — what it costs to leave
              alone — is the one that decides whether it gets built, and in a
              single box it is the one that goes missing.
            */}
            <div>
              <Typography.Text>What is difficult today?</Typography.Text>
              <Input.TextArea
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                placeholder="e.g. I have to open every bill to see which ones are already paid."
                rows={3}
                maxLength={2000}
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <Typography.Text>What would you like instead?</Typography.Text>
              <Input.TextArea
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="e.g. Show the paid amount and the balance in the bills list."
                rows={3}
                maxLength={2000}
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <Typography.Text>How much does it cost you today?</Typography.Text>
              <Radio.Group
                value={impact}
                onChange={(e) => setImpact(e.target.value as FeedbackImpact)}
                style={{ display: "block", marginTop: 6 }}
              >
                <Space direction="vertical" size={2}>
                  {FEEDBACK_IMPACTS.map((option) => (
                    <Radio key={option} value={option}>
                      {feedbackImpactLabel(option)}
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </div>

            <div>
              <Typography.Text>How often does it come up?</Typography.Text>
              <Radio.Group
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as FeedbackFrequency)}
                optionType="button"
                buttonStyle="solid"
                style={{ display: "block", marginTop: 6 }}
                options={FEEDBACK_FREQUENCIES.map((option) => ({
                  label: feedbackFrequencyLabel(option),
                  value: option,
                }))}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                These two decide the order suggestions get looked at. Neither is required.
              </Typography.Text>
            </div>

            <div>
              <Typography.Text>Anything else? (optional)</Typography.Text>
              <Input.TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Background, an example, or how you work round it today…"
                rows={3}
                maxLength={4000}
                style={{ marginTop: 6 }}
              />
            </div>
          </>
        )}

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
          {kind === "broken" ? "Send report" : "Send suggestion"}
        </Button>
      </Space>
    </Modal>
  );
}
