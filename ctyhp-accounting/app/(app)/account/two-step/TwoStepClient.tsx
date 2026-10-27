"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, Input, Space, Typography } from "antd";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import { PALETTE } from "@/lib/design/palette";
import { formatDateInTimeZone } from "@/lib/format";
import { useCompanyClock } from "@/components/CompanyClock";
import { readCode } from "@/lib/domain/two-step";

/** An enrollment under way: the factor exists but is not verified until a code is accepted. */
interface Pending {
  factorId: string;
  qr: string;
  secret: string;
}

const APPS = "Google Authenticator, Microsoft Authenticator or 1Password";

export default function TwoStepClient({ email, onSince }: { email: string; onSince: string | null }) {
  const { message } = App.useApp();
  const { timeZone } = useCompanyClock();
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  if (onSince) {
    return (
      <Card>
        <Alert
          type="success"
          showIcon
          message="Two-step sign-in is on"
          description={`Since ${formatDateInTimeZone(onSince, timeZone)}. Each time ${email} signs in, OneBook asks for the code your app shows after the password. Lost or replaced your phone? Ask an admin of your company to reset it in Settings › Users, then set it up again here.`}
        />
      </Card>
    );
  }

  async function start() {
    setBusy(true);
    const sb = createSupabaseBrowserClient();
    // A set-up that was started and never finished would block a new one with
    // the same name; it never protected anything, so it goes.
    const { data: existing } = await sb.auth.mfa.listFactors();
    for (const factor of existing?.all ?? []) {
      if (factor.status === "unverified") await sb.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app", issuer: "OneBook" });
    setBusy(false);
    if (error || !data) {
      message.error(error?.message ?? "Two-step sign-in could not be started");
      return;
    }
    setPending({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function cancel() {
    if (pending) await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: pending.factorId });
    setPending(null);
  }

  async function turnOn(values: { code: string }) {
    if (!pending) return;
    const code = readCode(values.code);
    if (!code) {
      message.error("Enter the six digits your app shows");
      return;
    }
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId: pending.factorId, code });
    setBusy(false);
    if (error) {
      message.error("That code did not match. Codes change every 30 seconds; enter the one showing now.");
      return;
    }
    message.success("Two-step sign-in is on");
    setPending(null);
    router.refresh();
  }

  if (!pending) {
    return (
      <Card>
        <Space direction="vertical" size="middle" style={{ display: "flex", maxWidth: 640 }}>
          <Alert
            type="info"
            showIcon
            message="Two-step sign-in is off"
            description="With it on, a password alone no longer opens your books: OneBook also asks for a six-digit code from an app on your phone. It is recommended for everyone and will be required for admins and accountants."
          />
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            You need an authenticator app on your phone, such as {APPS}. Setting it up takes about a minute.
          </Typography.Paragraph>
          <div>
            <Button type="primary" loading={busy} onClick={() => void start()}>
              Set up two-step sign-in
            </Button>
          </div>
        </Space>
      </Card>
    );
  }

  return (
    <Card>
      <Space direction="vertical" size="middle" style={{ display: "flex", maxWidth: 640 }}>
        <Typography.Text strong>1. Scan this code with your authenticator app</Typography.Text>
        {/* Supabase returns the code as an SVG data URI; it never leaves this
            page. White in both themes: a phone's camera reads dark on light. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pending.qr} width={200} height={200} alt="QR code to scan with your authenticator app" style={{ background: PALETTE.white, padding: 8, borderRadius: 8 }} />
        <Typography.Text type="secondary">
          Cannot scan it? In the app, choose to enter a key and type{" "}
          <Typography.Text code copyable>
            {pending.secret}
          </Typography.Text>
        </Typography.Text>
        <Typography.Text strong>2. Enter the six-digit code the app now shows</Typography.Text>
        <Form layout="inline" onFinish={turnOn} requiredMark={false}>
          <Form.Item name="code" rules={[{ required: true, message: "Enter the code" }]}>
            <Input
              aria-label="Six-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123 456"
              style={{ width: 140 }}
              autoFocus
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                Turn on
              </Button>
              <Button onClick={() => void cancel()} disabled={busy}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  );
}
