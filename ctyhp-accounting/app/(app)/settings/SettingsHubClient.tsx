"use client";
import Link from "next/link";
import { Card, Col, Row, Typography } from "antd";
import { SETTINGS_HUB } from "@/lib/domain/navigation";

/**
 * Client Component for the same reason PageHeader is one: Ant Design ships
 * "use client", so a Server Component that reaches for a compound sub-component
 * such as Typography.Title reads a static property off a client-reference proxy
 * and the render fails.
 */
export default function SettingsHubClient() {
  return (
    <>
      {SETTINGS_HUB.map((group) => (
        <section key={group.id} className="settings-hub__group">
          <Typography.Title level={4} className="settings-hub__group-title">
            {group.label}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {group.items.map((item) => (
              <Col xs={24} sm={12} lg={8} key={item.href}>
                <Link href={item.href} className="settings-hub__card-link">
                  <Card hoverable size="small" className="settings-hub__card">
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Paragraph type="secondary" className="settings-hub__card-description">
                      {item.description}
                    </Typography.Paragraph>
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        </section>
      ))}
    </>
  );
}
