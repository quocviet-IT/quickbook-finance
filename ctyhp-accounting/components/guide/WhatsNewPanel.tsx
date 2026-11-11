"use client";

import { formatDate } from "@/lib/format";
import IntentLink from "@/components/IntentLink";
import { Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { CHANGE_KIND_LABEL, versionLabel, type ChangeKind, type Release } from "@/lib/domain/changelog";
import { screenName } from "@/lib/domain/screen-names";

const KIND_COLOR: Record<ChangeKind, string> = {
  added: "green",
  changed: "blue",
  fixed: "orange",
};

export interface WhatsNewPanelProps {
  releases: Release[];
  /** Called when a change's link is followed. */
  onNavigate?: () => void;
  /**
   * The version, date and headline above the changes. Off where they are
   * already the label the release is opened by (2.51), so they are not said twice.
   */
  showHeading?: boolean;
}

/**
 * What changed, per release.
 *
 * Used for the guide's What's new tab and for the release notes a search finds.
 * One renderer, so the two can never drift into describing the same release
 * differently. A change's link names the screen ("See it on Backups"), never
 * its path (3.0.17).
 */
export default function WhatsNewPanel({ releases, onNavigate, showHeading = true }: WhatsNewPanelProps) {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {releases.map((release) => (
        <section key={release.version} className="release-notes__release">
          {showHeading ? (
            <>
              <div className="release-notes__head">
                <Typography.Text strong>{versionLabel(release.version)}</Typography.Text>
                <Typography.Text type="secondary">{formatDate(release.date)}</Typography.Text>
              </div>
              <Typography.Paragraph type="secondary" className="release-notes__headline">
                {release.headline}
              </Typography.Paragraph>
            </>
          ) : null}
          <ul className="release-notes__changes">
            {release.changes.map((change, index) => (
              <li key={`${release.version}-${index}`}>
                <Space size={6} wrap>
                  <Tag color={KIND_COLOR[change.kind]}>{CHANGE_KIND_LABEL[change.kind]}</Tag>
                  <Typography.Text strong>{change.title}</Typography.Text>
                </Space>
                {change.detail ? (
                  <Typography.Paragraph type="secondary" className="release-notes__detail">
                    {change.detail}
                  </Typography.Paragraph>
                ) : null}
                {change.route ? (
                  <IntentLink href={change.route} onClick={onNavigate}>
                    See it on {screenName(change.route)} <ArrowRightOutlined />
                  </IntentLink>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Space>
  );
}
