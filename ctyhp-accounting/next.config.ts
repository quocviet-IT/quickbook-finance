import type { NextConfig } from "next";

// Security headers applied to every response. A production deployment should
// additionally terminate TLS (HSTS below assumes HTTPS).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Provisioning a company reads the migration files at runtime. Nothing
  // imports them, so the tracer cannot see them and the deployed function would
  // try to build a company out of nothing. The route reports how many it found.
  outputFileTracingIncludes: {
    "/api/companies/provision": ["./supabase/migrations/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The two ageing reports were renamed to the US spelling. People bookmark a
  // report and screenshots of the old address are already out there, so the old
  // paths keep working permanently rather than turning into a 404.
  async redirects() {
    return [
      { source: "/reports/ar-ageing", destination: "/reports/ar-aging", permanent: true },
      { source: "/reports/ap-ageing", destination: "/reports/ap-aging", permanent: true },
    ];
  },
};

export default nextConfig;
