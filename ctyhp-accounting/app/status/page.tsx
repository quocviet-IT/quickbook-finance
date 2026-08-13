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

interface Outcome {
  payload: HealthPayload | null;
  unreachable: boolean;
}

/**
 * Ask the endpoint, and come back with an answer either way.
 *
 * Outside the component and holding no state, so the effect below can await it
 * without setting state synchronously — which React refuses, because it
 * cascades a second render before the first has painted.
 *
 * A 503 is data, not a failure: the endpoint answers with that status when
 * something is down, and the body still describes which checks failed. Only a
 * rejected fetch means One Book could not be reached at all.
 */
/**
 * Is this really the answer the endpoint promises, or something wearing its
 * shape?
 *
 * A gateway or firewall in front of the app can return JSON of its own. That
 * body parses, `status` comes back undefined, and a page that only asks "is it
 * down?" concludes it is not — and says everything is fine. Anything that is
 * not recognisably a health payload is treated as no answer at all.
 */
function isHealthPayload(value: unknown): value is HealthPayload {
  const candidate = value as HealthPayload | null;
  return (
    !!candidate &&
    (candidate.status === "ok" || candidate.status === "down") &&
    Array.isArray(candidate.checks)
  );
}

async function loadHealth(): Promise<Outcome> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      // Without this a hung endpoint never settles, and the page keeps showing
      // whatever it showed before — which during an outage is the reassurance
      // the reader must not be given.
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json();
    return isHealthPayload(body)
      ? { payload: body, unreachable: false }
      : { payload: null, unreachable: true };
  } catch {
    // Not hidden: this is the worst answer, and the page shows it rather than
    // leaving the reader with a blank screen.
    return { payload: null, unreachable: true };
  }
}

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

  const apply = useCallback((outcome: Outcome) => {
    setPayload(outcome.payload);
    setUnreachable(outcome.unreachable);
    setChecking(false);
  }, []);

  useEffect(() => {
    // The guard matters on a page somebody opens while things are broken: a
    // slow answer landing after they have navigated away would set state on a
    // component that is gone.
    let cancelled = false;
    void loadHealth().then((outcome) => {
      if (!cancelled) apply(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  /** The button's version. `checking` already starts raised for the first load. */
  const recheck = useCallback(() => {
    setChecking(true);
    void loadHealth().then(apply);
  }, [apply]);

  /**
   * Has anything actually been asked yet?
   *
   * This page is prerendered, so its first paint is served from a CDN before a
   * single probe has run. Treating "no answer yet" as "not down" put the words
   * "One Book is working" into that static HTML — so during an outage the one
   * screen built to tell a reader it is not their fault told them it was.
   *
   * Nothing is claimed until an answer arrives, and the claim is `!== "ok"`
   * rather than `=== "down"` so an unrecognised verdict fails towards caution.
   */
  const settled = payload !== null || unreachable;
  const down = unreachable || (payload !== null && payload.status !== "ok");

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <Space direction="vertical" size="large" style={{ display: "flex" }}>
        <Typography.Title level={1} style={{ marginBottom: 0 }}>
          One Book status
        </Typography.Title>

        <Alert
          type={!settled ? "info" : down ? "error" : "success"}
          showIcon
          message={
            // Being unable to reach One Book at all is not the same as finding
            // part of it broken, and saying "some" of it would understate a
            // total outage to the one person looking.
            !settled
              ? "Checking One Book…"
              : unreachable
                ? "One Book could not be reached"
                : down
                  ? "Some of One Book is not working"
                  : "One Book is working"
          }
          description={
            !settled
              ? "Asking One Book whether it is working. This takes a moment."
              : unreachable
                ? "Either One Book is down or this device has no connection to it. Nothing you did caused it."
                : down
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
          <Button icon={<ReloadOutlined />} loading={checking} onClick={recheck}>
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
