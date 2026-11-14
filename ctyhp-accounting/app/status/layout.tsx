import type { Metadata } from "next";

/**
 * The status page is a client component, which cannot name its own tab, so
 * this layout does (3.0.32). The root template adds "· One Book".
 */
export const metadata: Metadata = { title: "Status" };

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
