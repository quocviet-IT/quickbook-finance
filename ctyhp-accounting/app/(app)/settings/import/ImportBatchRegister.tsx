"use client";
import { useCallback, useEffect, useState } from "react";
import type { ImportBatchRow } from "@/lib/services/ledger-import";
import LedgerBatchList from "./LedgerBatchList";
import { listImportBatchesAction } from "./actions";

export interface ImportBatchRegisterProps {
  /** Bumped by the screen after an import, to pull the new batch into the list. */
  reloadKey: number;
  onChanged: () => void;
  /** Which tab's imports to show. One register, narrowed per tab. */
  source: RegisterSource;
}

export type RegisterSource =
  | "transactions"
  | "invoices"
  | "chart_of_accounts"
  | "customers"
  | "vendors"
  | "items";

const EMPTY_TEXT: Record<RegisterSource, string> = {
  transactions: "No transactions have been imported into this company yet.",
  invoices: "No invoices have been imported into this company yet.",
  chart_of_accounts: "No chart of accounts has been imported into this company yet.",
  customers: "No customers have been imported into this company yet.",
  vendors: "No vendors have been imported into this company yet.",
  items: "No products or services have been imported into this company yet.",
};

/**
 * What has been imported into this company on this tab.
 *
 * Every kind of import shares one register, so this is the same list and the
 * same Undo whichever tab shows it, narrowed to the kind that tab makes. It
 * owns its own fetch rather than being handed rows: the screen around it
 * already carries the file, the mapping and the preview, and one more piece of
 * state there earns nothing.
 *
 * Its reason for existing is Undo. Without it, reversing an import meant
 * somebody working out by hand which rows belonged to it and deleting them
 * through a database connection.
 */
export default function ImportBatchRegister({
  reloadKey,
  onChanged,
  source,
}: ImportBatchRegisterProps) {
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);

  const refresh = useCallback(() => {
    void listImportBatchesAction().then((result) => {
      if (result.ok && result.data) setBatches(result.data);
    });
  }, []);

  useEffect(refresh, [refresh, reloadKey]);

  return (
    <LedgerBatchList
      batches={batches.filter((batch) => batch.source === source)}
      canManage
      emptyText={EMPTY_TEXT[source]}
      onChanged={() => {
        refresh();
        onChanged();
      }}
    />
  );
}
