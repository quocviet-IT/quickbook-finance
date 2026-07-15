"use client";
import { Typography } from "antd";

/**
 * Page title + optional description. Lives in a Client Component because
 * Ant Design compound components (e.g. Typography.Title) lose their static
 * sub-components when referenced across the RSC boundary.
 */
export default function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Typography.Title level={3} style={{ marginBottom: description ? 4 : 0 }}>
        {title}
      </Typography.Title>
      {description && <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>}
    </div>
  );
}
