"use client";

import { useState } from "react";
import { Button, Tooltip } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import ReportDialog from "./ReportDialog";

/**
 * The floating Report control, present on every page. Marked as feedback chrome
 * so the screenshot capture leaves it out of the picture.
 */
export default function FeedbackLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="feedback-launcher" data-feedback-chrome="true">
        <Tooltip title="Report a problem or suggest an improvement" placement="left">
          <Button
            type="primary"
            shape="round"
            icon={<MessageOutlined />}
            onClick={() => setOpen(true)}
            aria-label="Report a problem"
          >
            Report
          </Button>
        </Tooltip>
      </div>
      <ReportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
