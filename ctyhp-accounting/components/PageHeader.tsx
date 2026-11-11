"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Breadcrumb, Typography, type BreadcrumbProps } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import IntentLink from "./IntentLink";
// Only the link's address: the guide's own data stays on the guide's pages.
import { helpHref } from "@/lib/domain/help-link";

/**
 * Page title + optional description. Lives in a Client Component because
 * Ant Design compound components (e.g. Typography.Title) lose their static
 * sub-components when referenced across the RSC boundary.
 *
 * Beside the title, a Help link (3.0.17) opens the guide on what covers this
 * screen. It replaces the guide drawer's "This screen" tab, which only those
 * who knew to open the drawer ever saw.
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
  const help = helpHref(usePathname() ?? "/");
  return (
    <header className="accounting-page-header">
      <div className="accounting-page-header__content">
        {breadcrumbItems?.length ? <Breadcrumb items={breadcrumbItems} /> : null}
        <div className="accounting-page-header__title-row">
          <Typography.Title level={1} className="accounting-page-header__title">
            {title}
          </Typography.Title>
          {help ? (
            <IntentLink href={help} className="accounting-page-header__help" aria-label={`Help for ${title}`}>
              <QuestionCircleOutlined aria-hidden="true" />
              <span>Help</span>
            </IntentLink>
          ) : null}
        </div>
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
