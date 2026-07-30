"use client";

import { useState } from "react";
import { Button, Space, Tooltip } from "antd";
import { MessageOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import AskAiPanel from "@/components/ai/AskAiPanel";
import ReportDialog from "@/components/feedback/ReportDialog";

/**
 * The floating help controls, present on every page: ask the assistant, or
 * report what just went wrong. Marked as feedback chrome so the report's
 * screenshot leaves these buttons out of the picture.
 */
export default function AssistantLauncher() {
  const [askOpen, setAskOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className="assistant-launcher" data-feedback-chrome="true">
        <Space size="small">
          <Tooltip title="Report a problem or suggest an improvement" placement="top">
            <Button
              shape="round"
              icon={<MessageOutlined />}
              onClick={() => setReportOpen(true)}
              aria-label="Report a problem"
            >
              Report
            </Button>
          </Tooltip>
          <Tooltip title="Ask about a feature or an accounting workflow" placement="top">
            <Button
              type="primary"
              shape="round"
              icon={<QuestionCircleOutlined />}
              onClick={() => setAskOpen(true)}
              aria-label="Ask AI"
            >
              Ask AI
            </Button>
          </Tooltip>
        </Space>
      </div>

      <AskAiPanel
        open={askOpen}
        onClose={() => setAskOpen(false)}
        onReportProblem={() => {
          // The panel's own "Report a problem" link, as in the reference design:
          // close the assistant so the screenshot captures the page, not the drawer.
          setAskOpen(false);
          setReportOpen(true);
        }}
      />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
