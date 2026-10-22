"use client";

import { useState } from "react";
import Link from "next/link";
import { App } from "antd";
import { makeRecurringAction } from "@/app/(app)/recurring/actions";
import type { RecurringDocumentType } from "@/lib/domain/recurring";
import { formatDate } from "@/lib/format";

/**
 * "Make it recurring" from a list's row menu: one call, and what happened said
 * in the design's words, with the way to Recurring Transactions to change it.
 */
export function useMakeRecurring() {
  const { message } = App.useApp();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const makeRecurring = async (type: RecurringDocumentType, id: string) => {
    if (pendingId) return;
    setPendingId(id);
    try {
      const result = await makeRecurringAction({ type, id });
      if (result.ok && result.data) {
        void message.success({
          content: (
            <span>
              Set to recur monthly from {formatDate(result.data.startDate)}.{" "}
              <Link href="/recurring">Change it on Recurring Transactions</Link>
            </span>
          ),
          duration: 6,
        });
      } else {
        void message.error(result.error ?? "It could not be made to recur.");
      }
    } finally {
      setPendingId(null);
    }
  };

  return { makeRecurring, pendingId };
}

/** The row menu's words for it, on every list. */
export const MAKE_RECURRING = "Make it recurring";
