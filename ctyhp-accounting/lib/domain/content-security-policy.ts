/**
 * The Content-Security-Policy every page is served with (2.95).
 *
 * Scripts run only when they carry this response's nonce, or when a script
 * that did started them ('strict-dynamic'): Next's own bootstrap and chunks,
 * the theme script in app/layout.tsx, and Plaid Link, which the banking page
 * loads with next/script. An injected <script> or an inline handler has no
 * nonce, so it does not run; that is the protection this buys. 'self' and the
 * Plaid host are there for browsers too old for 'strict-dynamic', which
 * ignore it and fall back to the list.
 *
 * What else the browser is allowed, and why, from the inventory taken on
 * 31 October 2026:
 *   style-src 'unsafe-inline'  Ant Design's CSS-variable <style> blocks and
 *                              React's style attributes; a nonce cannot cover
 *                              attributes.
 *   img-src data: blob:        the two-step QR code, a feedback screenshot and
 *                              statement pages drawn from a PDF.
 *   connect-src                server actions ('self'); Supabase for sign-in
 *                              and the uploads the browser makes itself
 *                              (attachments, feedback, statement files);
 *                              Plaid Link; data:/blob: for the screenshot.
 *   frame-src                  Plaid Link opens in a frame from its CDN.
 *   worker-src 'self' blob:    the pdf.js worker; a blob worker as fallback.
 *   frame-ancestors 'none'     no page is meant to be framed (as X-Frame-Options).
 *
 * In development React and the dev server evaluate code, so 'unsafe-eval' is
 * added there and only there. In production nothing needs it: zod's probe for
 * it is switched off in the browser (lib/zod.ts), and the one report left, on
 * /banking, is is-generator-function trying `Function` inside a try/catch. It
 * arrives with the node:crypto polyfill that lib/domain/banking-import.ts pulls
 * into that page, and falls back without it.
 */
/** The request header proxy.ts hands the nonce to the layout in. */
export const NONCE_HEADER = "x-nonce";

export interface PolicyInput {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL; its origin is what the browser may call. */
  supabaseUrl: string | undefined;
  development: boolean;
}

const PLAID_SCRIPT = "https://cdn.plaid.com";
const PLAID_API = "https://*.plaid.com";

/** `https://x.supabase.co` and its websocket twin, or nothing when unset. */
function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const { protocol, host } = new URL(url);
    return [`${protocol}//${host}`, `${protocol === "http:" ? "ws:" : "wss:"}//${host}`];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy({ nonce, supabaseUrl, development }: PolicyInput): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", PLAID_SCRIPT, ...(development ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...supabaseOrigins(supabaseUrl), PLAID_API, "data:", "blob:"]],
    ["frame-src", [PLAID_SCRIPT]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** 128 random bits, base64: a fresh one for every response. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
