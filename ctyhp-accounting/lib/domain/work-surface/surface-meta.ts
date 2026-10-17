import { formatDate, timeZoneLabel } from "@/lib/format";
import { freshnessOf } from "./freshness";
import type { SectionDataState, SectionEnvelope } from "./types";

/**
 * The line under an overview's subtitle: the date, the currency, the company's
 * time zone and when the page was worked out, once.
 *
 * It replaced a boxed strip that sat between the header and the work. The strip
 * right-aligned these facts, so on Sales, Purchases, Banking and Inventory its
 * left half was empty, and the time it printed was printed again under the
 * work list and again under the checks: three "computed at" on one screen.
 */

/** What a section tells the line: its name, when it was computed, and how it stands. */
export interface SurfaceSectionState {
  name: string;
  generatedAt: string;
  dataState: SectionDataState;
}

/** As of, currency and zone, in the words every overview uses. */
export function surfaceFacts(context: { asOf: string; currencyCode: string; timeZone: string }): string[] {
  return [`As of ${formatDate(context.asOf)}`, context.currencyCode, timeZoneLabel(context.timeZone)];
}

/** The two sections of an overview, without their rows: the line needs only their state. */
export function surfaceSections(data: {
  queue: SectionEnvelope<unknown>;
  controls: SectionEnvelope<unknown>;
}): SurfaceSectionState[] {
  return [
    { name: "Work", generatedAt: data.queue.generatedAt, dataState: data.queue.dataState },
    { name: "Checks", generatedAt: data.controls.generatedAt, dataState: data.controls.dataState },
  ];
}

/** True when a section's figures should not be relied on without a refresh. */
export function sectionIsStale(section: Pick<SurfaceSectionState, "generatedAt" | "dataState">, now: number = Date.now()): boolean {
  if (section.dataState === "unavailable") return false;
  return section.dataState === "stale" || freshnessOf(section.generatedAt, now) === "stale";
}

/**
 * What a section's own "Computed at" note says, or null for none.
 *
 * `always` is Accounting, which has no line of facts under its subtitle.
 * `when-stale` is the four overviews: their header already prints the time,
 * so a section says it again only when its figures have gone stale.
 */
export function sectionFreshnessNote(
  section: Pick<SurfaceSectionState, "generatedAt" | "dataState">,
  mode: "always" | "when-stale",
  now: number = Date.now(),
): SectionDataState | null {
  if (mode === "always") return section.dataState;
  return sectionIsStale(section, now) ? "stale" : null;
}

/**
 * Which sections are stale or missing, and the latest time any was computed.
 * Judged against the reader's clock (`now`), as the freshness rule is.
 */
export function summarizeSections(
  sections: readonly SurfaceSectionState[],
  now: number = Date.now(),
): { stale: string[]; unavailable: string[]; generatedAt: string | null } {
  return {
    stale: sections.filter((s) => sectionIsStale(s, now)).map((s) => s.name),
    unavailable: sections.filter((s) => s.dataState === "unavailable").map((s) => s.name),
    generatedAt: sections.map((s) => s.generatedAt).sort().at(-1) ?? null,
  };
}
