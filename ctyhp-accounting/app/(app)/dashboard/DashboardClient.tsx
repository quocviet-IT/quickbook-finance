"use client";
import { Alert, Card, Col, Row, Statistic } from "antd";
import PageHeader from "@/components/PageHeader";

export default function DashboardClient({
  accounts,
  entries,
}: {
  accounts: number;
  entries: number;
}) {
  return (
    <div>
      <PageHeader title="Dashboard" />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Foundation phase"
        description="The double-entry ledger is ready. Invoices, Banking, and Reports modules are being built."
      />
      <Row gutter={16}>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title="Accounts in chart" value={accounts} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title="Journal entries posted" value={entries} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
