"use client";

import { useState, useSyncExternalStore } from "react";
import { Button, Space, Tooltip } from "antd";
import {
  BookOutlined,
  DownOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import AskAiPanel from "@/components/ai/AskAiPanel";
import ReportDialog from "@/components/feedback/ReportDialog";
import SystemGuideDrawer from "@/components/guide/SystemGuideDrawer";
import {
  isLauncherCollapsed,
  launcherCollapsedServerSnapshot,
  setLauncherCollapsed,
  subscribeLauncherCollapsed,
} from "@/lib/client/launcher-preferences";

/**
 * The floating help controls, present on every page: ask the assistant, report
 * what just went wrong, or open the guide. Marked as feedback chrome so the
 * report's screenshot leaves these buttons out of the picture.
 *
 * They sit over the bottom-right corner, which on a long list is where the
 * totals and the pager are, so the cluster collapses to a single small button
 * and stays collapsed until it is opened again.
 */
export default function AssistantLauncher() {
  const [askOpen, setAskOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // The stored choice is a browser-only value: the server renders expanded and
  // React swaps in the real state on hydration, without a mismatch.
  const collapsed = useSyncExternalStore(
    subscribeLauncherCollapsed,
    isLauncherCollapsed,
    launcherCollapsedServerSnapshot,
  );

  return (
    <>
      <div className="assistant-launcher" data-feedback-chrome="true">
        {collapsed ? (
          <Tooltip title="Show the help controls" placement="left">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<QuestionCircleOutlined />}
              onClick={() => setLauncherCollapsed(false)}
              aria-label="Show the help controls"
              aria-expanded={false}
            />
          </Tooltip>
        ) : (
          <Space direction="vertical" size="small" align="end">
            <Tooltip title="Hide these buttons" placement="left">
              <Button
                size="small"
                shape="circle"
                icon={<DownOutlined />}
                onClick={() => setLauncherCollapsed(true)}
                aria-label="Hide the help controls"
                aria-expanded
              />
            </Tooltip>
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
            <Tooltip title="How each workflow runs, and which button does what" placement="top">
              <Button
                shape="round"
                icon={<BookOutlined />}
                onClick={() => setGuideOpen(true)}
                aria-label="System guide"
              >
                Guide
              </Button>
            </Tooltip>
          </Space>
        )}
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
      <SystemGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
