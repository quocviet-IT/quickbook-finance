"use client";

import type { ReactNode } from "react";
import { Button, Card, Empty, Result, Skeleton, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

export function PageLoading({
  title = "Loading",
  rows = 6,
}: {
  title?: string;
  rows?: number;
}) {
  return (
    <div className="accounting-page-state" role="status" aria-live="polite" aria-label={title}>
      <Skeleton active title={{ width: 220 }} paragraph={{ rows: 1, width: "42%" }} />
      <Card className="accounting-page-state__card">
        <Skeleton active title={false} paragraph={{ rows }} />
      </Card>
      <span className="accounting-sr-only">{title}</span>
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="accounting-page-state accounting-page-state--centered">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
        <Space direction="vertical" size={4}>
          <Typography.Title level={4}>{title}</Typography.Title>
          {description && <Typography.Text type="secondary">{description}</Typography.Text>}
          {action && <div className="accounting-empty-action">{action}</div>}
        </Space>
      </Empty>
    </Card>
  );
}

export function ErrorState({
  title = "We could not load this page",
  description = "The issue may be temporary. Try again, or contact an administrator if it continues.",
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Card className="accounting-page-state accounting-page-state--centered" role="alert">
      <Result
        status="error"
        title={title}
        subTitle={description}
        extra={
          onRetry ? (
            <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null
        }
      />
    </Card>
  );
}
