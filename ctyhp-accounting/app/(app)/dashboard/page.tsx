import { Card, Col, Row, Statistic, Typography, Alert } from "antd";
import { createSupabaseServerClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

async function countRows(table: string): Promise<number> {
  const sb = await createSupabaseServerClient();
  const { count } = await sb.from(table).select("id", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  const [accounts, entries] = await Promise.all([
    countRows("acc_account"),
    countRows("acc_journal_entry"),
  ]);

  return (
    <div>
      <Typography.Title level={3}>Bảng điều khiển</Typography.Title>
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
