"use client";

import Link from "next/link";
import { Alert, Collapse, Drawer, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import {
  GUIDE_FLOWS,
  GUIDE_NOTICES,
  GUIDE_VERSION,
  type GuideFlow,
} from "@/lib/domain/system-guide";

function FlowBody({ flow, onNavigate }: { flow: GuideFlow; onNavigate: () => void }) {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">{flow.purpose}</Typography.Text>
      <ol className="system-guide__steps">
        {flow.steps.map((step, index) => (
          <li key={`${flow.id}-${index}`}>
            <Typography.Text strong>{step.action}</Typography.Text>
            <div className="system-guide__control">
              <Tag>{step.control}</Tag>
              {step.route ? (
                <Link href={step.route} onClick={onNavigate}>
                  {step.route} <ArrowRightOutlined />
                </Link>
              ) : (
                <Typography.Text type="secondary">on this screen</Typography.Text>
              )}
            </div>
            {step.note ? (
              <Typography.Paragraph type="secondary" className="system-guide__note">
                {step.note}
              </Typography.Paragraph>
            ) : null}
          </li>
        ))}
      </ol>
    </Space>
  );
}

/**
 * The system guide: what each workflow is for, which control performs each step,
 * and a link to the page it lives on.
 *
 * It links to the live interface instead of embedding screenshots on purpose — a
 * screenshot of an accounting screen goes stale on the next layout change and
 * carries test data with it, while a named control plus a route stays true.
 */
export default function SystemGuideDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      title={
        <Space>
          <span>System guide</span>
          <Tag color="blue">Version {GUIDE_VERSION}</Tag>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={640}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {GUIDE_NOTICES.map((notice) => (
          <Alert
            key={notice.id}
            type={notice.id === "test-data" ? "warning" : "info"}
            showIcon
            message={notice.title}
            description={notice.body}
          />
        ))}

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Each workflow below lists the control that performs each step and the page
          it lives on. Open a page in place of a screenshot — the interface is the
          most accurate picture of itself.
        </Typography.Paragraph>

        <Collapse
          accordion
          items={GUIDE_FLOWS.map((flow) => ({
            key: flow.id,
            label: flow.title,
            children: <FlowBody flow={flow} onNavigate={onClose} />,
          }))}
        />
      </Space>
    </Drawer>
  );
}
