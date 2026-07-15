import { redirect } from "next/navigation";

export default function RootPage() {
  // proxy.ts redirects unauthenticated users to /login before this renders.
  redirect("/dashboard");
}
