function payloadFor(session, user) {
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user,
  };
  return "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function sessionCookieParts({ session, user, supabaseUrl }) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const encoded = payloadFor(session, user);
  const baseName = `sb-${ref}-auth-token`;
  const size = 3180;
  if (encoded.length <= size) return [{ name: baseName, value: encoded }];
  return Array.from({ length: Math.ceil(encoded.length / size) }, (_, index) => ({
    name: `${baseName}.${index}`,
    value: encoded.slice(index * size, (index + 1) * size),
  }));
}

export function sessionCookieHeader(input) {
  return sessionCookieParts(input).map(({ name, value }) => `${name}=${value}`).join("; ");
}

export function playwrightSessionCookies(input) {
  return sessionCookieParts(input).map(({ name, value }) => ({ name, value, url: input.appBaseUrl }));
}
