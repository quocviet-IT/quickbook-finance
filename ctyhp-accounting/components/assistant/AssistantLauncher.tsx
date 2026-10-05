"use client";

import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Badge, Button, Space, Tooltip } from "antd";
import {
  BookOutlined,
  DownOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { hasUnreadRelease } from "@/lib/domain/release-marker";
import {
  lastReleaseSeen,
  lastReleaseSeenServerSnapshot,
  subscribeReleaseNotes,
} from "@/lib/client/release-notes";
import {
  isLauncherCollapsed,
  launcherCollapsedServerSnapshot,
  setLauncherCollapsed,
  subscribeLauncherCollapsed,
} from "@/lib/client/launcher-preferences";

// The three panels behind these buttons — with the guide, the release notes and
// the screen catalog they carry — were most of the JavaScript every page loaded,
// for something opened by a click. They are fetched on the first click instead,
// and tests/unit/shell-bundle.test.ts keeps them out of the shell.
const AskAiPanel = dynamic(() => import("@/components/ai/AskAiPanel"), { ssr: false });
const ReportDialog = dynamic(() => import("@/components/feedback/ReportDialog"), { ssr: false });
const SystemGuideDrawer = dynamic(() => import("@/components/guide/SystemGuideDrawer"), {
  ssr: false,
});

/**
 * The floating help controls, present on every page: ask the assistant, report
 * what just went wrong, or open the guide. Marked as feedback chrome so the
 * report's screenshot leaves these buttons out of the picture.
 *
 * They sit over the bottom-right corner, which on a long list is where the
 * totals and the pager are, so the cluster collapses to a single small button
 * and stays collapsed until it is opened again.
 *
 * `appVersion` is the newest release, handed down by the server so the unread
 * dot can be answered without the changelog in the browser.
 */
export default function AssistantLauncher({ appVersion }: { appVersion: string }) {
  const [askOpen, setAskOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // Each panel is mounted on its first opening and then kept, so closing still
  // animates and a half-typed question or report survives a close.
  const [askMounted, setAskMounted] = useState(false);
  const [reportMounted, setReportMounted] = useState(false);
  const [guideMounted, setGuideMounted] = useState(false);
  function openAsk() {
    setAskMounted(true);
    setAskOpen(true);
  }
  function openReport() {
    setReportMounted(true);
    setReportOpen(true);
  }
  function openGuide() {
    setGuideMounted(true);
    setGuideOpen(true);
  }
  // Nothing is rendered as unread on the server: it cannot know what this
  // browser has read, and a dot that appears then vanishes on every page load
  // is how people learn to ignore a dot.
  const seenRelease = useSyncExternalStore(
    subscribeReleaseNotes,
    lastReleaseSeen,
    lastReleaseSeenServerSnapshot,
  );
  const hasNews = hasUnreadRelease(seenRelease, appVersion);
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
                  onClick={openReport}
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
                  onClick={openAsk}
                  aria-label="Ask AI"
                >
                  Ask AI
                </Button>
              </Tooltip>
            </Space>
            <Tooltip
              title={
                hasNews
                  ? "New in this version, and how each workflow runs"
                  : "How each workflow runs, and which button does what"
              }
              placement="top"
            >
              <Badge dot={hasNews} offset={[-6, 4]}>
                <Button
                  shape="round"
                  icon={<BookOutlined />}
                  onClick={openGuide}
                  aria-label={hasNews ? "System guide, with unread release notes" : "System guide"}
                >
                  Guide
                </Button>
              </Badge>
            </Tooltip>
          </Space>
        )}
      </div>

      {askMounted && (
        <AskAiPanel
          open={askOpen}
          onClose={() => setAskOpen(false)}
          onReportProblem={() => {
            // The panel's own "Report a problem" link, as in the reference design:
            // close the assistant so the screenshot captures the page, not the drawer.
            setAskOpen(false);
            openReport();
          }}
        />
      )}
      {reportMounted && <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />}
      {guideMounted && <SystemGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />}
    </>
  );
}
