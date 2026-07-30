"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { App, Button, Input, Modal, Space, Spin, Typography } from "antd";
import { BugOutlined } from "@ant-design/icons";
import {
  FEEDBACK_KINDS,
  feedbackKindLabel,
  type FeedbackKind,
  type FeedbackPageContext,
} from "@/lib/domain/feedback";
import { fileFeedbackReportAction } from "@/app/(app)/settings/feedback/actions";

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
    void capture();
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
      if (!res.ok) {
        message.error(res.error ?? "Failed to send the report");
        return;
      }
      message.success(
        res.data?.screenshotStored
          ? "Report sent with the screenshot. Thank you."
          : "Report sent. Thank you.",
      );
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

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          A screenshot of an accounting page can show customer names and amounts. It is
          stored privately and only staff with feedback access can open it.
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
