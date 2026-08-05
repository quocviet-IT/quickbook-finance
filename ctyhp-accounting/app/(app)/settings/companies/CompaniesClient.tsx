"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import NewCompanyModal from "./NewCompanyModal";
import {
  getCompanyRequestAction,
  retryCompanyRequestAction,
  type CompanyRequestView,
} from "./actions";

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
  const [open, setOpen] = useState(initialCreateOpen && canCreate);
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
      {canCreate ? (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New company
          </Button>
        </Space>
      ) : (
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
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            style={{ margin: "8px 0 24px" }}
            dataSource={openRequests}
            columns={[
              { title: "Company", dataIndex: "legal_name" },
              { title: "Key", dataIndex: "slug", width: 160 },
              {
                title: "Status",
                dataIndex: "status",
                width: 180,
                render: (s: CompanyRequestView["status"]) => (
                  <Tag color={REQUEST_STATUS[s].color}>{REQUEST_STATUS[s].text}</Tag>
                ),
              },
              {
                title: "Detail",
                dataIndex: "error",
                render: (error: string | null) => error ?? "—",
              },
              {
                title: "",
                key: "actions",
                width: 110,
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

      <Typography.Text strong>Companies</Typography.Text>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        style={{ marginTop: 8 }}
        dataSource={companies}
        columns={[
          {
            title: "Legal name",
            dataIndex: "legal_name",
            render: (name: string, r: CompanyRow) => (
              <Space size={6}>
                <span>{name}</span>
                {r.is_sample ? <Tag color="orange">sample</Tag> : null}
              </Space>
            ),
          },
          { title: "Key", dataIndex: "slug", width: 180 },
          { title: "Schema", dataIndex: "schema_name", width: 200 },
          {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (s: string) => <Tag color={s === "active" ? "green" : "default"}>{s}</Tag>,
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
