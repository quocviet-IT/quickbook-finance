import type { SupabaseClient } from "@supabase/supabase-js";
import {
  overduePeriodItem,
  recurringFailureItem,
  workQueueItemToPriority,
} from "@/lib/domain/accounting-dashboard/queue-items";
import type { DerivedQueueItem } from "@/lib/domain/accounting-dashboard/types";
import { listRecurringRuns } from "@/lib/services/recurring";
import { getDashboardWorkQueue } from "@/lib/services/work-queue";
import type { AccountingDashboardContext } from "./context";

/**
 * The work an accountant has, other than what the controls report.
 *
 * The existing `getDashboardWorkQueue` is reused rather than reimplemented —
 * it is already the one place that knows what counts as an overdue invoice or
 * a bill coming due, and a second copy of those rules would be a second answer
 * to the same question. What this adds is the accounting-only work that queue
 * never carried: periods left open past the days they cover, and recurring
 * runs that failed.
 *
 * Control failures are merged in by the composition layer, not here, so that
 * a failure to evaluate the controls cannot take this section down with it.
 */
export async function getAccountingWorkQueue(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
): Promise<DerivedQueueItem[]> {
  const confirmedAt = new Date().toISOString();
  const { asOf } = context;

  const [queue, runs] = await Promise.allSettled([
    getDashboardWorkQueue(sb, asOf),
    listRecurringRuns(sb, 50),
  ]);

  const items: DerivedQueueItem[] = [];

  if (queue.status === "fulfilled") {
    items.push(
      ...queue.value.items.map((item) => workQueueItemToPriority(item, asOf, confirmedAt)),
    );
  }

  items.push(
    ...context.overduePeriods.map((period) => overduePeriodItem(period, asOf, confirmedAt)),
  );

  if (runs.status === "fulfilled") {
    items.push(
      ...runs.value
        .filter((run) => run.status === "failed")
        .map((run) =>
          recurringFailureItem(
            {
              id: run.id,
              // listRecurringRuns already flattens the template relation and
              // supplies a fallback name, so there is nothing to unwrap here.
              templateName: run.template_name ?? "A recurring schedule",
              runDate: run.scheduled_date.slice(0, 10),
            },
            asOf,
            confirmedAt,
          ),
        ),
    );
  }

  return items;
}
