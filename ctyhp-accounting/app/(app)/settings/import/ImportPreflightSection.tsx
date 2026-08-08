"use client";
import { useEffect, useMemo, useState } from "react";
import { App } from "antd";
import type { AccountRow } from "@/lib/db/types";
import type { ImportPreflight, UnbankedRef } from "@/lib/services/import-preflight";
import ImportPreflightPanel from "./ImportPreflightPanel";
import CreateAccountFromImport from "./CreateAccountFromImport";
import AddBankRecordFromImport from "./AddBankRecordFromImport";
import { importPreflightAction } from "./actions";

export interface ImportPreflightSectionProps {
  rows: string[][];
  mapping: Record<string, number | null>;
  accounts: AccountRow[];
  overrides: Record<string, string>;
  onOverridesChange: (next: Record<string, string>) => void;
}

/**
 * The pre-flight, and the two ways to answer what it finds.
 *
 * Its own component because it owns its own question: it re-asks the database
 * every time the reader answers part of it, and the screen around it is already
 * carrying the file, the mapping and the preview. It is also the only part of
 * the import that writes before the import — creating an account, declaring a
 * bank — so keeping it together makes that easy to see.
 */
export default function ImportPreflightSection({
  rows,
  mapping,
  accounts,
  overrides,
  onOverridesChange,
}: ImportPreflightSectionProps) {
  const { message } = App.useApp();
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  /** Accounts created from inside this panel, before the page is loaded again. */
  const [created, setCreated] = useState<AccountRow[]>([]);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [bankTarget, setBankTarget] = useState<UnbankedRef | null>(null);
  /** Bumped to ask again after something is created rather than chosen. */
  const [recheck, setRecheck] = useState(0);

  // The mapping is part of the question — which column holds the bank, which
  // holds the account — so it is keyed on, not captured once.
  const mappingKey = JSON.stringify(mapping);
  const overrideKey = JSON.stringify(overrides);
  const known = useMemo(() => [...accounts, ...created], [accounts, created]);

  useEffect(() => {
    if (rows.length === 0) return;
    // Answers can arrive out of order once somebody is clicking through a list
    // of them, and a stale one would put a solved problem back on screen.
    let live = true;
    void importPreflightAction(
      "transactions",
      rows,
      JSON.parse(mappingKey),
      JSON.parse(overrideKey),
    ).then((result) => {
      if (!live) return;
      if (result.ok && result.data) setPreflight(result.data);
      else message.error(result.error ?? "Could not check the file against this company");
    });
    return () => {
      live = false;
    };
  }, [rows, mappingKey, overrideKey, recheck, message]);

  if (!preflight) return null;

  return (
    <>
      <ImportPreflightPanel
        preflight={preflight}
        accounts={known}
        overrides={overrides}
        onOverride={(ref, accountCode) => {
          const next = { ...overrides };
          if (accountCode) next[ref] = accountCode;
          else delete next[ref];
          onOverridesChange(next);
        }}
        onCreateAccount={setCreatingFor}
        onAddBankRecord={setBankTarget}
      />

      <CreateAccountFromImport
        ref={creatingFor}
        onClose={() => setCreatingFor(null)}
        onCreated={(account) => {
          // In the picker at once, and already chosen for the name it was
          // created from — which is the only reason it was created.
          setCreated((current) => [
            ...current,
            {
              ...(account as unknown as AccountRow),
              status: "active",
            } as AccountRow,
          ]);
          if (creatingFor) onOverridesChange({ ...overrides, [creatingFor]: account.account_code });
          setCreatingFor(null);
        }}
      />

      <AddBankRecordFromImport
        target={bankTarget}
        onClose={() => setBankTarget(null)}
        onAdded={() => {
          setBankTarget(null);
          setRecheck((count) => count + 1);
        }}
      />
    </>
  );
}
