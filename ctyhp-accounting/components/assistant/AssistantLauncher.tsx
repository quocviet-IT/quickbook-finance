"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, Space, Tooltip } from "antd";
import {
  BookOutlined,
  DownOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import AskAiPanel from "@/components/ai/AskAiPanel";
import ReportDialog from "@/components/feedback/ReportDialog";
import SystemGuideDrawer from "@/components/guide/SystemGuideDrawer";
import type { GuideCompany } from "@/lib/domain/system-guide";
import { releasesSince } from "@/lib/domain/changelog";
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

/**
 * The floating help controls, present on every page: ask the assistant, report
 * what just went wrong, or open the guide. Marked as feedback chrome so the
 * report's screenshot leaves these buttons out of the picture.
 *
 * They sit over the bottom-right corner, which on a long list is where the
 * totals and the pager are, so the cluster collapses to a single small button
 * and stays collapsed until it is opened again.
 *
 * The UI review of 2026-10-20 found them over figures and buttons on some
 * twenty-five pages. Three changes answer it:
 * - one row, 40px tall, where it was three rows stacked over 105px;
 * - a Hide button you can see, where the collapse handle was a faint 24px dot;
 * - room left below every page for whatever the cluster's height is, measured
 *   here and handed to the content as `--assistant-launcher-clearance`, so the
 *   last row of any page can be scrolled clear of it.
 */

/** Space between the bottom of a page's content and the top of the cluster, once scrolled to the end. */
const CLEARANCE_GAP = 12;

export default function AssistantLauncher({ company = null }: { company?: GuideCompany | null } = {}) {
  const box = useRef<HTMLDivElement>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // Nothing is rendered as unread on the server: it cannot know what this
  // browser has read, and a dot that appears then vanishes on every page load
  // is how people learn to ignore a dot.
  const seenRelease = useSyncExternalStore(
    subscribeReleaseNotes,
    lastReleaseSeen,
    lastReleaseSeenServerSnapshot,
  );
  const hasNews = releasesSince(seenRelease).length > 0;
  // The stored choice is a browser-only value: the server renders expanded and
  // React swaps in the real state on hydration, without a mismatch.
  const collapsed = useSyncExternalStore(
    subscribeLauncherCollapsed,
    isLauncherCollapsed,
    launcherCollapsedServerSnapshot,
  );

  // The room the pages leave at their foot follows the cluster as it is drawn:
  // open or collapsed, on a wide screen or a phone.
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      const inset = parseFloat(getComputedStyle(element).bottom) || 0;
      const height = element.getBoundingClientRect().height;
      root.style.setProperty("--assistant-launcher-clearance", `${Math.ceil(height + inset + CLEARANCE_GAP)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--assistant-launcher-clearance");
    };
  }, []);

  return (
    <>
      {/* Out of sight while the guide or Ask AI is open (2.51): the cluster sat on
          the drawer's last lines, its tooltip over the text. Hidden, not removed,
          so the room it reserves at the foot of the page does not jump. */}
      <div
        ref={box}
        className={`assistant-launcher${guideOpen || askOpen ? " assistant-launcher--behind-panel" : ""}`}
        data-feedback-chrome="true"
      >
        {collapsed ? (
          <Tooltip title="Show Report, Ask AI and Guide" placement="left">
            <Badge dot={hasNews} offset={[-4, 4]}>
              <Button
                type="primary"
                shape="circle"
                size="large"
                icon={<QuestionCircleOutlined />}
                onClick={() => setLauncherCollapsed(false)}
                aria-label={hasNews ? "Show the help buttons, with unread release notes" : "Show the help buttons"}
                aria-expanded={false}
              />
            </Badge>
          </Tooltip>
        ) : (
          <Space size="small" align="center" className="assistant-launcher__row">
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
                  onClick={() => setGuideOpen(true)}
                  aria-label={hasNews ? "System guide, with unread release notes" : "System guide"}
                >
                  Guide
                </Button>
              </Badge>
            </Tooltip>
            <Tooltip title="Hide these buttons; one ? button stays to bring them back" placement="topRight">
              <Button
                shape="circle"
                icon={<DownOutlined />}
                onClick={() => setLauncherCollapsed(true)}
                aria-label="Hide the help buttons"
                aria-expanded
              />
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
      <SystemGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} company={company} />
    </>
  );
}
