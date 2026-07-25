const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Builds the destination used by Supabase password-recovery emails.
 * Server Actions already validate Origin against Host; this adds URL validation
 * before an incoming origin is passed to the identity provider.
 */
export function buildPasswordSetupUrl(origin: string): string {
  const url = new URL(origin);
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error("The application origin must use HTTP or HTTPS");
  }
  url.pathname = "/auth/set-password";
  url.search = "";
  url.hash = "";
  return url.toString();
}
