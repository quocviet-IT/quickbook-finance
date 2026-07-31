/**
 * Sales tax by state.
 *
 * Pure. A company registered in several states keeps one rate per state and
 * files one return per state, so both the rate picker and the liability read
 * the same grouping from here rather than each inventing its own.
 */

export interface JurisdictionTaxCode {
  id: string;
  code: string;
  name: string;
  rate_percent: number;
  direction: string;
  is_active: boolean;
  state_code: string | null;
}

export interface UsState {
  code: string;
  name: string;
}

/** Codes with no state sort last, under one heading rather than scattered. */
export const NO_STATE_LABEL = "No state";

export function stateName(code: string | null, states: readonly UsState[]): string {
  if (!code) return NO_STATE_LABEL;
  return states.find((state) => state.code === code)?.name ?? code;
}

/** `CA — CA Sales Tax (7.25%)`: the state first, because that is what is chosen. */
export function taxCodeLabel(code: JurisdictionTaxCode): string {
  const rate = `${Number(code.rate_percent)}%`;
  return code.state_code
    ? `${code.state_code} — ${code.code} (${rate})`
    : `${code.code} (${rate})`;
}

export interface TaxCodeGroup {
  stateCode: string | null;
  stateName: string;
  codes: JurisdictionTaxCode[];
}

/**
 * Active sales-direction codes, grouped by state in state-name order. Used for
 * the invoice line picker, so a seller in ten states finds the right rate by
 * looking for the state rather than by remembering a code.
 */
export function groupTaxCodesByState(
  codes: readonly JurisdictionTaxCode[],
  states: readonly UsState[],
  options: { direction?: string; activeOnly?: boolean } = {},
): TaxCodeGroup[] {
  const { direction = "sales", activeOnly = true } = options;
  const relevant = codes.filter(
    (code) =>
      (!direction || code.direction === direction) && (!activeOnly || code.is_active),
  );

  const groups = new Map<string, TaxCodeGroup>();
  for (const code of relevant) {
    const key = code.state_code ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        stateCode: code.state_code,
        stateName: stateName(code.state_code, states),
        codes: [],
      };
      groups.set(key, group);
    }
    group.codes.push(code);
  }

  for (const group of groups.values()) {
    group.codes.sort((a, b) => a.code.localeCompare(b.code));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.stateCode === null) return 1;
    if (b.stateCode === null) return -1;
    return a.stateName.localeCompare(b.stateName);
  });
}

export interface StateLiabilityLine {
  stateCode: string | null;
  stateName: string;
  taxableMinor: number;
  taxMinor: number;
  /** The codes that make the total up, so a return can be tied back to them. */
  codes: { code: string; ratePercent: number; taxableMinor: number; taxMinor: number }[];
}

export interface CollectedLine {
  taxCodeId: string;
  code: string;
  ratePercent: number;
  taxableMinor: number;
  taxMinor: number;
}

/**
 * Tax collected in the period, rolled up the way it is filed — one line per
 * state, largest first. A code the liability names but the rate list no longer
 * has still appears, under "No state": money collected is never dropped from a
 * total because its code was reclassified.
 */
export function liabilityByState(
  collected: readonly CollectedLine[],
  codes: readonly JurisdictionTaxCode[],
  states: readonly UsState[],
): StateLiabilityLine[] {
  const stateOf = new Map(codes.map((code) => [code.id, code.state_code]));
  const lines = new Map<string, StateLiabilityLine>();

  for (const entry of collected) {
    const code = stateOf.get(entry.taxCodeId) ?? null;
    const key = code ?? "";
    let line = lines.get(key);
    if (!line) {
      line = {
        stateCode: code,
        stateName: stateName(code, states),
        taxableMinor: 0,
        taxMinor: 0,
        codes: [],
      };
      lines.set(key, line);
    }
    line.taxableMinor += entry.taxableMinor;
    line.taxMinor += entry.taxMinor;
    line.codes.push({
      code: entry.code,
      ratePercent: entry.ratePercent,
      taxableMinor: entry.taxableMinor,
      taxMinor: entry.taxMinor,
    });
  }

  return [...lines.values()].sort((a, b) => {
    if (b.taxMinor !== a.taxMinor) return b.taxMinor - a.taxMinor;
    return a.stateName.localeCompare(b.stateName);
  });
}

/**
 * The rate to offer for a customer in a given state — destination sourcing, the
 * rule most states apply to a sale shipped to a buyer. Returns null when the
 * company has no active rate registered there, which is itself the answer: do
 * not charge tax you are not registered to collect.
 */
export function defaultTaxCodeForState(
  region: string | null | undefined,
  codes: readonly JurisdictionTaxCode[],
): JurisdictionTaxCode | null {
  const state = (region ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const matches = codes.filter(
    (code) => code.is_active && code.direction === "sales" && code.state_code === state,
  );
  if (matches.length !== 1) return null; // Two rates in one state is a choice, not a default.
  return matches[0];
}
