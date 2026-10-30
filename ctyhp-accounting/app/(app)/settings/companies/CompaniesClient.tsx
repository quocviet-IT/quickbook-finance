"use client";
import { useCallback, useEffect, useState } from "react";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import StatusTag from "@/components/ui/StatusTag";
import FilterBar from "@/components/ui/FilterBar";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import NewCompanyModal from "./NewCompanyModal";
import {
  getCompanyRequestAction,
  retryCompanyRequestAction,
  type CompanyRequestView,
} from "./actions";

/**
 * Status, Try again. Company and Detail share what is left: a legal name and
 * the reason a build failed are both text of unknown length.
 */
export const COMPANY_REQUESTS_FIXED_WIDTHS = [COLUMN.STATUS, COLUMN.ACTION * 3] as const;
/** The floors of Company and Detail, in that order. */
export const COMPANY_REQUESTS_ELASTIC_FLOORS = [160, COLUMN.TEXT_MIN] as const;

/** Status. Legal name takes what is left, at least COLUMN.TEXT_MIN. */
export const COMPANIES_FIXED_WIDTHS = [COLUMN.STATUS] as const;

export interface CompanyRow {
  id: string;
  slug: string;
  schema_name: string;
  legal_name: string;
  is_sample: boolean;
  status: string;
  display_order: number;
}

const REQUEST_STATUS: Record<CompanyRequestView["status"], { text: string; color: string }> = {
  pending: { text: "Waiting", color: "default" },
  running: { text: "Building the books", color: "processing" },
  ready: { text: "Ready", color: "green" },
  failed: { text: "Failed", color: "red" },
};

/**
 * Creating a company takes about twenty seconds — 75 tables, 196 functions and
 * 135 security policies. So the request is shown as a row with a state, not as
 * a spinner: closing the tab does not lose it, and a failure leaves its reason
 * where somebody can read it.
 */
export default function CompaniesClient({
  initialCreateOpen,
  canCreate,
  companies,
  requests,
}: {
  initialCreateOpen: boolean;
  canCreate: boolean;
  companies: CompanyRow[];
  requests: CompanyRequestView[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useInitiallyOpen(initialCreateOpen && canCreate);
  const [watching, setWatching] = useState<string | null>(
    requests.find((r) => r.status === "pending" || r.status === "running")?.id ?? null,
  );
  const [retrying, setRetrying] = useState<string | null>(null);

  // Poll only while something is actually being built.
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await getCompanyRequestAction(watching);
      if (cancelled || !res.ok || !res.data) return;
      if (res.data.status === "ready" || res.data.status === "failed") {
        setWatching(null);
        router.refresh();
        if (res.data.status === "ready") {
          message.success(`${res.data.legal_name} is ready — it is now in the company list`);
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, router, message]);

  const onQueued = useCallback(
    (requestId: string) => {
      setWatching(requestId);
      router.refresh();
    },
    [router],
  );

  async function retry(id: string) {
    setRetrying(id);
    try {
      const res = await retryCompanyRequestAction(id);
      if (!res.ok) {
        message.error(res.error ?? "Could not retry");
        return;
      }
      setWatching(id);
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  const openRequests = requests.filter((r) => r.status !== "ready");

  return (
    <div>
      <FilterBar
        ariaLabel="Companies"
        resultCount={companies.length}
        actions={
          canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              New company
            </Button>
          ) : undefined
        }
      />
      {canCreate ? null : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Only a platform administrator can create a company."
        />
      )}

      {openRequests.length > 0 ? (
        <>
          <Typography.Text strong>In progress</Typography.Text>
          <DataTable<CompanyRequestView>
            rowKey="id"
            pagination={false}
            style={{ margin: "8px 0 24px" }}
            rows={openRequests}
            columns={[
              flexColumn<CompanyRequestView>({
                title: "Company",
                dataIndex: "legal_name",
                floor: COMPANY_REQUESTS_ELASTIC_FLOORS[0],
              }),
              {
                title: "Status",
                dataIndex: "status",
                width: COMPANY_REQUESTS_FIXED_WIDTHS[0],
                render: (s: CompanyRequestView["status"]) => (
                  <Tag color={REQUEST_STATUS[s].color}>{REQUEST_STATUS[s].text}</Tag>
                ),
              },
              flexColumn<CompanyRequestView>({
                title: "Detail",
                dataIndex: "error",
                floor: COMPANY_REQUESTS_ELASTIC_FLOORS[1],
                render: (error: string | null) => error ?? "—",
              }),
              {
                title: "",
                key: "actions",
                width: COMPANY_REQUESTS_FIXED_WIDTHS[1],
                render: (_: unknown, r: CompanyRequestView) =>
                  r.status === "failed" && canCreate ? (
                    <Button size="small" loading={retrying === r.id} onClick={() => retry(r.id)}>
                      Try again
                    </Button>
                  ) : null,
              },
            ]}
          />
        </>
      ) : null}

      {/* The key and the schema are how the system addresses a company, not
          anything a reader acts on, and putting a Postgres schema name in front
          of an accountant only invites questions. Both are still on the row —
          `CompanyRow` carries them — they are simply not shown. */}
      <Typography.Text strong>Companies</Typography.Text>
      <DataTable<CompanyRow>
        rowKey="id"
        pagination={false}
        style={{ marginTop: 8 }}
        rows={companies}
        columns={[
          flexColumn<CompanyRow>({
            title: "Legal name",
            dataIndex: "legal_name",
            render: (name: string, r: CompanyRow) => (
              <Space size={6}>
                <span>{name}</span>
                {r.is_sample ? <Tag color="orange">Sample</Tag> : null}
              </Space>
            ),
          }),
          {
            title: "Status",
            dataIndex: "status",
            width: COMPANIES_FIXED_WIDTHS[0],
            render: (s: string) => <StatusTag status={s} />,
          },
        ]}
      />

      <NewCompanyModal
        open={open}
        existingSlugs={companies.map((c) => c.slug)}
        onClose={() => setOpen(false)}
        onQueued={onQueued}
      />
    </div>
  );
}
