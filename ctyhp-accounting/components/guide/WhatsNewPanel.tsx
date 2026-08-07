"use client";

import Link from "next/link";
import { Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { CHANGE_KIND_LABEL, type ChangeKind, type Release } from "@/lib/domain/changelog";

const KIND_COLOR: Record<ChangeKind, string> = {
  added: "green",
  changed: "blue",
  fixed: "orange",
};

export interface WhatsNewPanelProps {
  releases: Release[];
  /** Closes the drawer when a change links somewhere. */
  onNavigate: () => void;
}

/**
 * What changed, per release.
 *
 * Used twice: for the releases this browser has not read, and for the whole
 * history behind "Show every release". One renderer, so the two can never drift
 * into describing the same release differently.
 */
export default function WhatsNewPanel({ releases, onNavigate }: WhatsNewPanelProps) {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {releases.map((release) => (
        <section key={release.version} className="release-notes__release">
          <div className="release-notes__head">
            <Typography.Text strong>Version {release.version}</Typography.Text>
            <Typography.Text type="secondary">{release.date}</Typography.Text>
          </div>
          <Typography.Paragraph type="secondary" className="release-notes__headline">
            {release.headline}
          </Typography.Paragraph>
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
                  <Link href={change.route} onClick={onNavigate}>
                    {change.route} <ArrowRightOutlined />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Space>
  );
}
