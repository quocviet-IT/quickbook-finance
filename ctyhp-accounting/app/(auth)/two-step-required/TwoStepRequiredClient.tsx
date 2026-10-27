"use client";
import { useRouter } from "next/navigation";
import { Button, Typography } from "antd";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import { TOKENS } from "@/lib/design/tokens";
import TwoStepClient from "@/app/(app)/account/two-step/TwoStepClient";

export default function TwoStepRequiredClient({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: TOKENS.surface.muted,
        paddingInline: 16,
      }}
    >
      <div style={{ width: "100%", maxWidth: 680 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          One Book
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Signed in as {email}.{" "}
          <Button type="link" style={{ paddingInline: 0 }} onClick={() => void signOut()}>
            Sign out
          </Button>
        </Typography.Paragraph>
        <TwoStepClient email={email} onSince={null} required />
      </div>
    </div>
  );
}
