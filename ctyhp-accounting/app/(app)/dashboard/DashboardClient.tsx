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
      <PageHeader title="Bảng điều khiển" />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Giai đoạn nền tảng"
        description="Sổ kép đã sẵn sàng. Các module Hóa đơn, Ngân hàng, Báo cáo đang được xây dựng."
      />
      <Row gutter={16}>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title="Tài khoản trong hệ thống" value={accounts} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title="Bút toán đã ghi sổ" value={entries} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
