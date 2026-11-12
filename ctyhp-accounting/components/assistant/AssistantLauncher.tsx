"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Button, Space, Tooltip } from "antd";
import { DownOutlined, MessageOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import AbacusMark from "@/components/abacus/AbacusMark";
import ReportDialog from "@/components/feedback/ReportDialog";
import {
  isLauncherCollapsed,
  launcherCollapsedServerSnapshot,
  setLauncherCollapsed,
  subscribeLauncherCollapsed,
} from "@/lib/client/launcher-preferences";

/**
 * The floating help controls, present on every page: ask the assistant, or
 * report what just went wrong. Marked as feedback chrome so the report's
 * screenshot leaves these buttons out of the picture.
 *
 * The guide used to open from here too, as a drawer. People hid this cluster
 * to see the figures under it and then could not find the guide, so in 3.0.17
 * it became a page in the left menu, with a Help link on every screen; the
 * release-notes dot moved with it.
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

/**
 * Abacus is fetched when it is first wanted, not with every page (3.0.20): it
 * carries the guide's answers, the bundled manual and its own views, and the
 * floating buttons sit on every screen. Pointing at the button starts the
 * download, so it is usually there by the time it is pressed. Once opened it
 * stays mounted, so closing and opening again keeps the conversation.
 */
const AbacusPanel = dynamic(() => import("@/components/abacus/AbacusPanel"), { ssr: false });

function preloadAbacus() {
  void import("@/components/abacus/AbacusPanel");
}

export default function AssistantLauncher() {
  const box = useRef<HTMLDivElement>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askWanted, setAskWanted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
      {/* Out of sight while Abacus is open (2.51): the cluster sat on the
          panel's last lines, its tooltip over the text. Hidden, not removed, so
          the room it reserves at the foot of the page does not jump. */}
      <div
        ref={box}
        className={`assistant-launcher${askOpen ? " assistant-launcher--behind-panel" : ""}`}
        data-feedback-chrome="true"
      >
        {collapsed ? (
          <Tooltip title="Show Report and Ask Abacus" placement="left">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<QuestionCircleOutlined />}
              onClick={() => setLauncherCollapsed(false)}
              aria-label="Show the help buttons"
              aria-expanded={false}
            />
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
            <Tooltip title="Ask how something in OneBook works" placement="top">
              <Button
                type="primary"
                shape="round"
                icon={<AbacusMark size={22} />}
                onClick={() => {
                  setAskWanted(true);
                  setAskOpen(true);
                }}
                onMouseEnter={preloadAbacus}
                onFocus={preloadAbacus}
                aria-label="Ask Abacus"
              >
                Ask Abacus
              </Button>
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

      {askWanted ? (
        <AbacusPanel
          open={askOpen}
          onClose={() => setAskOpen(false)}
          onReportProblem={() => {
            // The panel's own "Report a problem" link, as in the reference design:
            // close the assistant so the screenshot captures the page, not the drawer.
            setAskOpen(false);
            setReportOpen(true);
          }}
        />
      ) : null}
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
