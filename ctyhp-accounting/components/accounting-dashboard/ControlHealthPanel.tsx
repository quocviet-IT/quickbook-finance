"use client";
import ControlPanel from "@/components/work-surface/ControlPanel";
import type { AccountingControl, SectionEnvelope } from "@/lib/domain/accounting-dashboard/types";

/**
 * Whether the books are safe, in the order an accountant asks.
 *
 * The drawing moved to `components/work-surface/ControlPanel.tsx` in Phase 6 —
 * a check with a pass condition and a state is the same object on every surface,
 * and four copies of that rail would be four places for the rule "colour never
 * carries the message alone" to be forgotten in three of them.
 *
 * What stays here is what belongs to accounting: the panel's name, and that
 * `blocksClose` is this area's word for the shared `blocking` flag.
 */
export default function ControlHealthPanel({
  controls,
  currencyCode,
  currencyDecimals,
}: {
  controls: SectionEnvelope<AccountingControl[]>;
  currencyCode: string;
  currencyDecimals: number;
}) {
  return (
    <ControlPanel
      controls={{
        ...controls,
        data:
          controls.data?.map((control) => ({ ...control, blocking: control.blocksClose })) ??
          null,
      }}
      currencyCode={currencyCode}
      currencyDecimals={currencyDecimals}
      title="Control health"
      unavailableFallback="The accounting controls could not be evaluated."
      className="accounting-control-health"
    />
  );
}
