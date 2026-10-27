"use client";
import Link from "next/link";
import { Alert, Button } from "antd";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateInTimeZone, plural } from "@/lib/format";
import { daysLeft } from "@/lib/domain/two-step";

/**
 * Shown to an admin or accountant without a second sign-in step while the
 * seven days 2.66 gives them run (0175). After the deadline the layout sends
 * them to set it up instead.
 */
export default function TwoStepReminder({ requiredFrom }: { requiredFrom: string }) {
  const { timeZone } = useCompanyClock();
  const days = daysLeft(requiredFrom);
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={`Set up two-step sign-in: ${plural(days, "day")} left`}
      description={`From ${formatDateInTimeZone(requiredFrom, timeZone)}, admins and accountants need a code from an authenticator app after their password. It takes about a minute.`}
      action={
        <Link href="/account/two-step">
          <Button size="small" type="primary">
            Set it up
          </Button>
        </Link>
      }
    />
  );
}
