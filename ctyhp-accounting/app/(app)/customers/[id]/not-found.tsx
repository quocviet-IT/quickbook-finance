import Link from "next/link";
import { Button } from "antd";
import { EmptyState } from "@/components/ui/PageStates";

export default function CustomerNotFound() {
  return (
    <EmptyState
      title="Customer not found"
      description="It may have been removed, or the link is wrong."
      action={
        <Link href="/customers">
          <Button type="primary">Back to Customers</Button>
        </Link>
      }
    />
  );
}
