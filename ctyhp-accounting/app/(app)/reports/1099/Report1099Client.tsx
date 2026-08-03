"use client";
import { useState } from "react";
import { Alert, App, Button, Card, Col, InputNumber, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { toCsv } from "@/lib/csv";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import type { Report1099, Vendor1099Assessed } from "@/lib/services/vendorTax";
import { report1099Action } from "../../vendors/tax-actions";

const label = (v: string) => v.replace(/_/g, " ");

export default function Report1099Client({
  defaultYear,
  baseCurrency,
  baseDecimals,
  companyName,
}: {
  defaultYear: number;
  baseCurrency: string;
  baseDecimals: number;
  /** Whose books the exported file belongs to. */
  companyName: string;
}) {
  const { message } = App.useApp();
  const [year, setYear] = useState(defaultYear);
  const [rep, setRep] = useState<Report1099 | null>(null);
  const [loading, setLoading] = useState(false);

  const money = (m: number) =>
    fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  async function run() {
    setLoading(true);
    const res = await report1099Action({ year });
    setLoading(false);
    if (res.ok && res.data) setRep(res.data);
    else message.error(res.error ?? "Failed to run the 1099 review");
  }

  function exportCsv() {
    if (!rep) return;
    const csv = toCsv(
      rep.rows.map((r) => ({
        vendor: r.vendor_name,
        reporting_name: r.reporting_name ?? "",
        classification: r.classification ?? "",
        w9_status: r.w9_status,
        tin_on_file: r.tin_on_file ? "yes" : "no",
        address_complete: r.address_complete ? "yes" : "no",
        form_box: r.box_code ?? "",
        paid: fromMinor(r.paid_minor, baseDecimals).toFixed(baseDecimals),
        reportable: r.reportable ? "yes" : "no",
        exceptions: r.exceptions.map((e) => `${e.severity}: ${e.message}`).join("; "),
      })),
      [
        { key: "vendor", header: "Vendor" },
        { key: "reporting_name", header: "Reporting name" },
        { key: "classification", header: "Classification" },
        { key: "w9_status", header: "W-9 status" },
        { key: "tin_on_file", header: "TIN on file" },
        { key: "address_complete", header: "Address complete" },
        { key: "form_box", header: "Form box" },
        { key: "paid", header: `Paid (${baseCurrency})` },
        { key: "reportable", header: "Reportable" },
        { key: "exceptions", header: "Exceptions" },
      ],
    );
    const identified = csvWithReportIdentity(csv, {
      companyName,
      title: "1099 Review",
      subtitle: `Tax year ${rep.year} · cash basis`,
      currencyCode: baseCurrency,
    });
    const blob = new Blob([identified], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `1099-review-${rep.year}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        message="Review data, not a filing"
        description="This dataset supports 1099 preparation and must be reviewed by a qualified professional before anything is filed. The reporting box configured on a vendor applies to every payment to that vendor in the year, so a vendor paid for both services and merchandise will be over-stated here — adjust before filing. Backup withholding is not modelled; a missing taxpayer identifier is flagged as a blocker instead."
      />

      <FilterBar
        resultCount={rep ? rep.rows.length : undefined}
        ariaLabel="1099 review filters"
        actions={
          <Space>
            {rep && (
              <Button onClick={exportCsv} disabled={rep.rows.length === 0}>
                Export CSV
              </Button>
            )}
            <Button type="primary" loading={loading} onClick={run}>
              Run review
            </Button>
          </Space>
        }
      >
        <InputNumber
          value={year}
          min={2000}
          max={2100}
          onChange={(v) => setYear(Number(v ?? defaultYear))}
          aria-label="Tax year"
          style={{ width: 120 }}
        />
      </FilterBar>

      {rep && (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic title="Vendors reportable" value={rep.reportableCount} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic title={`Reportable total (${baseCurrency})`} value={money(rep.reportableTotalMinor)} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic title="Vendors with blockers" value={rep.blockerCount} valueStyle={rep.blockerCount ? { color: "#cf1322" } : undefined} />
              </Card>
            </Col>
          </Row>

          <Table<Vendor1099Assessed>
            rowKey="vendor_id"
            dataSource={rep.rows}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "No vendor was paid and none is marked eligible for this year" }}
            columns={[
              { title: "Vendor", dataIndex: "vendor_name" },
              { title: "Reporting name", dataIndex: "reporting_name", render: (v: string | null) => v ?? "—" },
              {
                title: "Classification",
                dataIndex: "classification",
                render: (v: string | null) => (v ? label(v) : "—"),
              },
              {
                title: "W-9",
                dataIndex: "w9_status",
                render: (v: string) => <Tag color={v === "on_file" ? "green" : v === "expired" ? "red" : "gold"}>{label(v)}</Tag>,
              },
              {
                title: "TIN",
                dataIndex: "tin_on_file",
                render: (v: boolean) => (v ? <Tag color="green">on file</Tag> : <Tag color="red">missing</Tag>),
              },
              {
                title: "Box",
                dataIndex: "box_code",
                render: (v: string | null, r) =>
                  v ? <Tooltip title={r.box_label ?? ""}>{v}</Tooltip> : "—",
              },
              {
                title: `Paid (${baseCurrency})`,
                dataIndex: "paid_minor",
                align: "right",
                render: (v: number) => money(Number(v)),
              },
              {
                title: "Reportable",
                dataIndex: "reportable",
                render: (v: boolean) => (v ? <Tag color="blue">yes</Tag> : <Tag>no</Tag>),
              },
              {
                title: "Exceptions",
                key: "exceptions",
                render: (_, r) =>
                  r.exceptions.length === 0 ? (
                    <Tag color="green">clean</Tag>
                  ) : (
                    <Space direction="vertical" size={2}>
                      {r.exceptions.map((e) => (
                        <Tooltip key={e.code} title={e.message}>
                          <Tag color={e.severity === "blocker" ? "red" : "orange"}>{label(e.code)}</Tag>
                        </Tooltip>
                      ))}
                    </Space>
                  ),
              },
            ]}
          />

          <Alert
            type={rep.tiesOut ? "success" : "warning"}
            showIcon
            message={
              `Rows total ${money(rep.rowsTotalMinor)} vs payments recorded ${money(rep.controlTotalMinor)} ${baseCurrency}` +
              (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")
            }
            description={
              rep.tiesOut
                ? "Every payment made to a vendor in the year is represented in the rows above."
                : "Some payment is not represented in the rows above; do not use this dataset until it reconciles."
            }
          />
          <Typography.Text type="secondary">
            Cash basis — payments made between {rep.year}-01-01 and {rep.year}-12-31, in {baseCurrency}.
          </Typography.Text>
        </>
      )}
    </Space>
  );
}
