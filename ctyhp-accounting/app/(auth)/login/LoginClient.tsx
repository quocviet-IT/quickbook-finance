"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Form, Input, Typography } from "antd";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import { tokenVar } from "@/lib/design/tokens";
import { owesSecondStep, readCode, verifiedAppFactors } from "@/lib/domain/two-step";

interface LoginValues {
  email: string;
  password: string;
}

type Step = "password" | "code";

/** The session's own answer: has its owner set up a second step it has not yet passed? */
async function sessionOwesCode(sb: SupabaseClient): Promise<boolean> {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

export default function LoginClient({ initialStep }: { initialStep: Step }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);

  // Sent here for the code (the app layout does that for a session that owes
  // it): still signed in, and still owing it? If not, there is nothing to ask.
  useEffect(() => {
    if (initialStep !== "code") return;
    let alive = true;
    void (async () => {
      const sb = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!alive) return;
      if (!session) setStep("password");
      else if (!(await sessionOwesCode(sb))) router.replace("/dashboard");
    })();
    return () => {
      alive = false;
    };
  }, [initialStep, router]);

  function enter() {
    router.refresh();
    router.push("/dashboard");
  }

  async function onPassword(values: LoginValues) {
    setLoading(true);
    const sb = createSupabaseBrowserClient();
    const { data, error } = await sb.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setLoading(false);
    if (error) {
      message.error(error.message);
      return;
    }
    if (owesSecondStep(data.user?.factors, null)) {
      setStep("code");
      return;
    }
    enter();
  }

  async function onCode(values: { code: string }) {
    const code = readCode(values.code);
    if (!code) {
      message.error("Enter the six digits your authenticator app shows");
      return;
    }
    setLoading(true);
    const sb = createSupabaseBrowserClient();
    const { data: factors, error: listError } = await sb.auth.mfa.listFactors();
    const factor = verifiedAppFactors(factors?.all)[0];
    if (listError || !factor) {
      setLoading(false);
      message.error(listError?.message ?? "No authenticator app is set up for this account");
      return;
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setLoading(false);
    if (error) {
      message.error("That code did not match. Codes change every 30 seconds; enter the one showing now.");
      return;
    }
    enter();
  }

  async function signInAsSomeoneElse() {
    await createSupabaseBrowserClient().auth.signOut();
    setStep("password");
    router.replace("/login");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: tokenVar("surface.muted"),
      }}
    >
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: "center", marginBottom: 4 }}>
          One Book
        </Typography.Title>
        {step === "password" ? (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
              Sign in to continue
            </Typography.Paragraph>
            <Form layout="vertical" onFinish={onPassword} requiredMark={false}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ required: true, type: "email", message: "Enter a valid email" }]}
              >
                <Input autoComplete="email" placeholder="you@company.com" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Password"
                rules={[{ required: true, message: "Enter your password" }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                Sign in
              </Button>
            </Form>
          </>
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
              Enter the six-digit code your authenticator app shows for OneBook.
            </Typography.Paragraph>
            <Form layout="vertical" onFinish={onCode} requiredMark={false}>
              <Form.Item name="code" label="Code" rules={[{ required: true, message: "Enter the code" }]}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123 456"
                  autoFocus
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                Verify
              </Button>
            </Form>
            <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 13 }}>
              Lost or replaced your phone? Ask an admin of your company to reset your two-step sign-in.
            </Typography.Paragraph>
            <Button type="link" style={{ paddingInline: 0 }} onClick={() => void signInAsSomeoneElse()}>
              Sign in as someone else
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
