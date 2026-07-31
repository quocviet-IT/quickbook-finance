import { describe, expect, it } from "vitest";
import {
  defaultTaxCodeForState,
  groupTaxCodesByState,
  liabilityByState,
  stateName,
  taxCodeLabel,
  type JurisdictionTaxCode,
} from "@/lib/domain/tax-jurisdiction";

const STATES = [
  { code: "CA", name: "California" },
  { code: "NY", name: "New York" },
  { code: "TX", name: "Texas" },
];

function code(overrides: Partial<JurisdictionTaxCode> & { id: string; code: string }): JurisdictionTaxCode {
  return {
    name: overrides.code,
    rate_percent: 7,
    direction: "sales",
    is_active: true,
    state_code: null,
    ...overrides,
  };
}

const CA = code({ id: "ca", code: "CA-SALES", rate_percent: 7.25, state_code: "CA" });
const CA_DISTRICT = code({ id: "ca2", code: "CA-LA", rate_percent: 9.5, state_code: "CA" });
const NY = code({ id: "ny", code: "NY-SALES", rate_percent: 4, state_code: "NY" });
const TX = code({ id: "tx", code: "TX-SALES", rate_percent: 6.25, state_code: "TX" });
const EXEMPT = code({ id: "ex", code: "EXEMPT", rate_percent: 0 });

describe("labels", () => {
  it("leads with the state, because that is what is being chosen", () => {
    expect(taxCodeLabel(CA)).toBe("CA — CA-SALES (7.25%)");
    expect(taxCodeLabel(EXEMPT)).toBe("EXEMPT (0%)");
  });

  it("names a state, and says so when there is none", () => {
    expect(stateName("TX", STATES)).toBe("Texas");
    expect(stateName(null, STATES)).toBe("No state");
    expect(stateName("ZZ", STATES)).toBe("ZZ");
  });
});

describe("groupTaxCodesByState", () => {
  it("groups by state in state-name order, codes sorted inside", () => {
    const groups = groupTaxCodesByState([TX, NY, CA_DISTRICT, CA], STATES);
    expect(groups.map((group) => group.stateName)).toEqual(["California", "New York", "Texas"]);
    expect(groups[0].codes.map((c) => c.code)).toEqual(["CA-LA", "CA-SALES"]);
  });

  it("keeps codes with no state, last", () => {
    const groups = groupTaxCodesByState([EXEMPT, TX], STATES);
    expect(groups.map((group) => group.stateName)).toEqual(["Texas", "No state"]);
  });

  it("offers only active sales codes to a sales screen", () => {
    const retired = code({ id: "old", code: "CA-OLD", state_code: "CA", is_active: false });
    const purchase = code({ id: "pur", code: "USE-TAX", state_code: "CA", direction: "purchase" });
    const groups = groupTaxCodesByState([CA, retired, purchase], STATES);
    expect(groups).toHaveLength(1);
    expect(groups[0].codes.map((c) => c.code)).toEqual(["CA-SALES"]);
  });

  it("can list everything when the rates screen asks for it", () => {
    const retired = code({ id: "old", code: "CA-OLD", state_code: "CA", is_active: false });
    const groups = groupTaxCodesByState([CA, retired], STATES, {
      activeOnly: false,
      direction: "",
    });
    expect(groups[0].codes).toHaveLength(2);
  });
});

describe("liabilityByState", () => {
  const collected = [
    { taxCodeId: "ca", code: "CA-SALES", ratePercent: 7.25, taxableMinor: 100_000, taxMinor: 7_250 },
    { taxCodeId: "ca2", code: "CA-LA", ratePercent: 9.5, taxableMinor: 20_000, taxMinor: 1_900 },
    { taxCodeId: "tx", code: "TX-SALES", ratePercent: 6.25, taxableMinor: 400_000, taxMinor: 25_000 },
  ];

  it("rolls up one line per state, biggest liability first", () => {
    const lines = liabilityByState(collected, [CA, CA_DISTRICT, TX], STATES);
    expect(lines.map((line) => [line.stateName, line.taxMinor])).toEqual([
      ["Texas", 25_000],
      ["California", 9_150],
    ]);
    expect(lines[1].taxableMinor).toBe(120_000);
    expect(lines[1].codes.map((c) => c.code)).toEqual(["CA-SALES", "CA-LA"]);
  });

  it("never drops tax collected under a code the rate list no longer classifies", () => {
    const lines = liabilityByState(collected, [CA, CA_DISTRICT], STATES);
    const orphan = lines.find((line) => line.stateCode === null)!;
    expect(orphan.stateName).toBe("No state");
    expect(orphan.taxMinor).toBe(25_000);
  });

  it("reports nothing for a period with no tax", () => {
    expect(liabilityByState([], [CA], STATES)).toEqual([]);
  });
});

describe("defaultTaxCodeForState", () => {
  it("offers the rate registered in the customer's state", () => {
    expect(defaultTaxCodeForState("TX", [CA, TX])?.code).toBe("TX-SALES");
    expect(defaultTaxCodeForState("tx", [CA, TX])?.code).toBe("TX-SALES");
  });

  it("offers nothing where the company has no rate registered", () => {
    expect(defaultTaxCodeForState("NY", [CA, TX])).toBeNull();
  });

  it("refuses to guess when a state has more than one rate", () => {
    expect(defaultTaxCodeForState("CA", [CA, CA_DISTRICT])).toBeNull();
  });

  it("ignores a region that is not a state code", () => {
    expect(defaultTaxCodeForState("California", [CA])).toBeNull();
    expect(defaultTaxCodeForState(null, [CA])).toBeNull();
    expect(defaultTaxCodeForState("", [CA])).toBeNull();
  });

  it("never offers an inactive or purchase-side rate", () => {
    const retired = code({ id: "old", code: "TX-OLD", state_code: "TX", is_active: false });
    expect(defaultTaxCodeForState("TX", [retired])).toBeNull();
    const use = code({ id: "u", code: "TX-USE", state_code: "TX", direction: "purchase" });
    expect(defaultTaxCodeForState("TX", [use])).toBeNull();
  });
});
