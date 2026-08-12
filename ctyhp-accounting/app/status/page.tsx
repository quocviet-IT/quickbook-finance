"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, List, Space, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ReloadOutlined } from "@ant-design/icons";
import { TOKENS } from "@/lib/design/tokens";
import type { HealthPayload } from "@/lib/domain/health";

const LABELS: Record<string, string> = {
  database: "Database",
  authentication: "Sign-in service",
  configuration: "Configuration",
};

/**
 * Whether the application is working, for a person rather than a monitor.
 *
 * A member of staff whose screen has gone wrong wants one answer: is it the
 * application or is it me. Before this page the only way to find out was to
 * telephone somebody.
 *
 * It asks once on load and then only when asked again. Polling on a timer would
 * have the page hammer its own endpoint to tell one reader something they can
 * see by pressing a button.
 */
export default function StatusPage() {
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setPayload((await response.json()) as HealthPayload);
      setUnreachable(false);
    } catch {
      // The endpoint itself could not be reached. That is an answer, and the
      // worst one, so it is shown rather than left as a blank page.
      setPayload(null);
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const down = unreachable || payload?.status === "down";

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <Space direction="vertical" size="large" style={{ display: "flex" }}>
        <Typography.Title level={1} style={{ marginBottom: 0 }}>
          One Book status
        </Typography.Title>

        <Alert
          type={down ? "error" : "success"}
          showIcon
          message={down ? "Some of One Book is not working" : "One Book is working"}
          description={
            down
              ? "If a screen is not behaving, this is why. Nothing you did caused it."
              : "If a screen is not behaving, the problem is not with One Book itself."
          }
        />

        <Card>
          <List
            dataSource={payload?.checks ?? []}
            locale={{ emptyText: unreachable ? "Could not reach One Book at all." : "Checking…" }}
            renderItem={(check) => (
              <List.Item
                actions={[
                  check.status === "ok" ? (
                    <Typography.Text style={{ color: TOKENS.intent.success }}>
                      <CheckCircleFilled /> Working
                    </Typography.Text>
                  ) : (
                    <Typography.Text style={{ color: TOKENS.intent.danger }}>
                      <CloseCircleFilled /> Not working
                    </Typography.Text>
                  ),
                ]}
              >
                {LABELS[check.name] ?? check.name}
              </List.Item>
            )}
          />
        </Card>

        <Space>
          <Button icon={<ReloadOutlined />} loading={checking} onClick={() => void check()}>
            Check again
          </Button>
          {payload && (
            <Typography.Text type="secondary">
              Checked {new Date(payload.checkedAt).toLocaleTimeString()}
            </Typography.Text>
          )}
        </Space>
      </Space>
    </main>
  );
}
