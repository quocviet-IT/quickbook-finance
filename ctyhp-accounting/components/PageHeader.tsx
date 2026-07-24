"use client";
import type { ReactNode } from "react";
import { Breadcrumb, Typography, type BreadcrumbProps } from "antd";

/**
 * Page title + optional description. Lives in a Client Component because
 * Ant Design compound components (e.g. Typography.Title) lose their static
 * sub-components when referenced across the RSC boundary.
 */
export default function PageHeader({
  title,
  description,
  actions,
  breadcrumbItems,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbItems?: BreadcrumbProps["items"];
  meta?: ReactNode;
}) {
  return (
    <header className="accounting-page-header">
      <div className="accounting-page-header__content">
        {breadcrumbItems?.length ? <Breadcrumb items={breadcrumbItems} /> : null}
        <Typography.Title level={1} className="accounting-page-header__title">
          {title}
        </Typography.Title>
        {description && (
          <Typography.Paragraph type="secondary" className="accounting-page-header__description">
            {description}
          </Typography.Paragraph>
        )}
        {meta && <div className="accounting-page-header__meta">{meta}</div>}
      </div>
      {actions && <div className="accounting-page-header__actions">{actions}</div>}
    </header>
  );
}
