import Link from "next/link";
import { Button } from "antd";
import { EmptyState } from "@/components/ui/PageStates";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The accounting page or record may have moved, or you may not have access to it."
      action={
        <Link href="/dashboard">
          <Button type="primary">Return to dashboard</Button>
        </Link>
      }
    />
  );
}
