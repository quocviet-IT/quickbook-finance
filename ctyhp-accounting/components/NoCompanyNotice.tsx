"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Result, Typography } from "antd";
import { createSupabaseBrowserClient } from "@/lib/db/client";

/**
 * What an account entitled to no company sees.
 *
 * This screen exists because the alternative was worse than an error: the app
 * used to fall back to the first company's schema, so somebody with a role in
 * those books and no entitlement to them read a real customer's ledger while
 * their own company switcher showed nothing at all.
 *
 * It names the account, because the commonest cause is signing in as the wrong
 * one, and it says what to ask for rather than only what went wrong.
 */
export default function NoCompanyNotice({
  email,
  canCreateCompany,
}: {
  email: string;
  canCreateCompany: boolean;
}) {
  const router = useRouter();

  // The same two steps AppShell's account menu takes. There is no /logout
  // route to link to — signing out is a client call.
  async function signOut() {
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <Card style={{ maxWidth: 620, width: "100%" }}>
        <Result
          status="info"
          title="This account has no company yet"
          subTitle={
            <>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                You are signed in as <strong>{email}</strong>, but this account has not been
                given access to any company&apos;s books.
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Ask an administrator of the company you work on to add you. If you expected to
                see one already, check whether you signed in with the right address.
              </Typography.Paragraph>
            </>
          }
          extra={[
            canCreateCompany ? (
              <Link key="create" href="/settings/companies">
                <Button type="primary">Create a company</Button>
              </Link>
            ) : null,
            <Button key="out" onClick={() => void signOut()}>
              Sign in as somebody else
            </Button>,
          ].filter(Boolean)}
        />
      </Card>
    </div>
  );
}
