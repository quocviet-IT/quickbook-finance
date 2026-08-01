"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert, Collapse, Drawer, Empty, Input, Segmented, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined, SearchOutlined } from "@ant-design/icons";
import {
  GUIDE_FLOWS,
  GUIDE_NOTICES,
  GUIDE_VERSION,
  type GuideFlow,
} from "@/lib/domain/system-guide";
import { screenContextFor, searchGuide } from "@/lib/domain/screen-context";

function FlowBody({
  flow,
  onNavigate,
  here,
}: {
  flow: GuideFlow;
  onNavigate: () => void;
  /** The screen the reader is actually on, so a step can say "you are here". */
  here?: string;
}) {
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
                step.route === here ? (
                  <Tag color="green">you are here</Tag>
                ) : (
                  <Link href={step.route} onClick={onNavigate}>
                    {step.route} <ArrowRightOutlined />
                  </Link>
                )
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
  const pathname = usePathname() ?? "/";
  const [scope, setScope] = useState<"here" | "all">("here");
  const [query, setQuery] = useState("");

  const screen = useMemo(() => screenContextFor(pathname), [pathname]);
  const relevant = useMemo(
    () => [
      ...screen.flowsStartingHere,
      ...screen.flowsPassingThrough.map((entry) => entry.flow),
    ],
    [screen],
  );

  // Searching means searching everything; nobody types a term expecting it to
  // be filtered by which page they happen to be standing on.
  const results = useMemo(() => (query.trim() ? searchGuide(query) : null), [query]);

  const shown: GuideFlow[] = results
    ? results.map((match) => match.flow)
    : scope === "here"
      ? relevant
      : GUIDE_FLOWS;

  const openByDefault = shown.length === 1 ? [shown[0].id] : [];

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
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search the guide — try a button name, like 'void'"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {!query.trim() ? (
          <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
            <Segmented
              value={scope}
              onChange={(value) => setScope(value as "here" | "all")}
              options={[
                { label: `This screen (${relevant.length})`, value: "here" },
                { label: `Everything (${GUIDE_FLOWS.length})`, value: "all" },
              ]}
            />
            <Tag color="blue">{screen.route}</Tag>
          </Space>
        ) : (
          <Typography.Text type="secondary">
            {shown.length} workflow(s) mention “{query.trim()}”
          </Typography.Text>
        )}

        {!query.trim() && scope === "here" && screen.summary ? (
          <Alert type="info" showIcon message={screen.summary} />
        ) : null}

        {shown.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              query.trim()
                ? `Nothing in the guide mentions “${query.trim()}”.`
                : "No workflow starts or passes through this screen yet."
            }
          >
            {!query.trim() ? (
              <Typography.Link onClick={() => setScope("all")}>
                Show every workflow
              </Typography.Link>
            ) : null}
          </Empty>
        ) : (
          <Collapse
            accordion
            defaultActiveKey={openByDefault}
            items={shown.map((flow) => ({
              key: flow.id,
              label: (
                <Space size={6} wrap>
                  <span>{flow.title}</span>
                  {flow.route === screen.route ? <Tag color="green">starts here</Tag> : null}
                </Space>
              ),
              children: <FlowBody flow={flow} onNavigate={onClose} here={screen.route} />,
            }))}
          />
        )}

        {/* The caveats belong at the end: they matter, but they are not what
            somebody opened the guide to read. */}
        {GUIDE_NOTICES.map((notice) => (
          <Alert
            key={notice.id}
            type={notice.id === "test-data" ? "warning" : "info"}
            showIcon
            message={notice.title}
            description={notice.body}
          />
        ))}
      </Space>
    </Drawer>
  );
}
