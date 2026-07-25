import Link from "next/link";
import { Card, Col, Row, Typography } from "antd";
import PageHeader from "@/components/PageHeader";
import { SETTINGS_HUB } from "@/lib/domain/navigation";

export const dynamic = "force-dynamic";

/**
 * One entry in the sidebar instead of a leaf per screen. The catalog lives in
 * lib/domain/navigation.ts and a unit test asserts every /settings/* route the
 * app serves appears here, so a new settings page cannot go unreachable.
 */
export default async function SettingsHubPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Company profile, the accounting calendar, who has access, and the controls around it."
      />
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
    </div>
  );
}
