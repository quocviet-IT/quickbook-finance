import LoginClient from "./LoginClient";

/**
 * Sign in. `?step=code` is where the app layout sends a session that owes its
 * second step (2.65); the proxy lets a signed-in visitor through only for that.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  return <LoginClient initialStep={step === "code" ? "code" : "password"} />;
}
