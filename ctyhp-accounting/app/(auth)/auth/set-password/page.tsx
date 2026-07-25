"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, Input, Spin, Typography } from "antd";
import { createSupabaseBrowserClient } from "@/lib/db/client";

interface PasswordValues {
  password: string;
  confirm_password: string;
}

type LinkState = "checking" | "ready" | "invalid";
const RECOVERY_SESSION_KEY = "ctyhp-password-recovery";

export default function SetPasswordPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [linkError, setLinkError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const providerError = params.get("error_description") ?? hashParams.get("error_description");
    const hasRecoverySignal =
      params.has("code") ||
      params.get("type") === "recovery" ||
      hashParams.get("type") === "recovery" ||
      window.sessionStorage.getItem(RECOVERY_SESSION_KEY) === "1";
    const supabase = createSupabaseBrowserClient();

    if (providerError) {
      const timer = window.setTimeout(() => {
        setLinkError(providerError);
        setLinkState("invalid");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error || !data.session || !hasRecoverySignal) {
        window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
        setLinkError("This password setup link is invalid or has expired. Ask an administrator to create a new one.");
        setLinkState("invalid");
        return;
      }
      setLinkState("ready");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        window.sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
        if (mounted) setLinkState("ready");
      }
    });

    void checkSession();
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function submit(values: PasswordValues) {
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setSaving(false);
      message.error(error.message);
      return;
    }

    await supabase.auth.signOut();
    window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
    message.success("Password created. You can now sign in.");
    router.replace("/login?password-created=1");
    router.refresh();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ textAlign: "center", marginBottom: 4 }}>
          Create your password
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          Set a secure password for your CTYHP Accounting account.
        </Typography.Paragraph>

        {linkState === "checking" && (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <Spin tip="Checking your secure link" />
          </div>
        )}

        {linkState === "invalid" && (
          <>
            <Alert type="error" showIcon message="Password link unavailable" description={linkError} />
            <Button block style={{ marginTop: 16 }} onClick={() => router.replace("/login")}>
              Back to sign in
            </Button>
          </>
        )}

        {linkState === "ready" && (
          <Form<PasswordValues> layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item
              name="password"
              label="New password"
              rules={[
                { required: true, message: "Enter a password" },
                { min: 12, message: "Use at least 12 characters" },
                { pattern: /[a-z]/, message: "Include a lowercase letter" },
                { pattern: /[A-Z]/, message: "Include an uppercase letter" },
                { pattern: /\d/, message: "Include a number" },
                { pattern: /[^A-Za-z0-9]/, message: "Include a special character" },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label="Confirm password"
              dependencies={["password"]}
              rules={[
                { required: true, message: "Confirm your password" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || getFieldValue("password") === value
                      ? Promise.resolve()
                      : Promise.reject(new Error("The passwords do not match"));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={saving}>
              Create password
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}
