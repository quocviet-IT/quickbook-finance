import { describe, expect, it } from "vitest";
import { filterContacts, type FilterableContact } from "@/lib/domain/contact-filter";

function contact(overrides: Partial<FilterableContact> = {}): FilterableContact {
  return {
    name: "Aurora Gemstone Supply Inc.",
    email: "orders@auroragems.com",
    phone: "555-0142",
    contact_name: "Maya Chen",
    city: "Houston",
    region: "TX",
    is_active: true,
    ...overrides,
  };
}

const BOOK: FilterableContact[] = [
  contact(),
  contact({
    name: "Harbor Metals",
    email: null,
    contact_name: null,
    phone: null,
    city: "Portland",
    region: "OR",
  }),
  contact({
    name: "Coastal Refinery",
    is_active: false,
    city: "Houston",
    // Its own contact details: inheriting the default fixture's email and
    // contact person made "maya" match two rows and hid what was under test.
    email: "ap@coastalref.com",
    contact_name: "Jordan Reyes",
    phone: "555-0177",
  }),
];

describe("filterContacts", () => {
  it("returns everything when nothing is asked", () => {
    expect(filterContacts(BOOK, "", "all")).toHaveLength(3);
  });

  it("matches the name, ignoring case", () => {
    // The professional-app convention this implements (QuickBooks' "Find a
    // customer", Xero's contact search) is one box that just works; nobody
    // types the capitalisation the record happens to have.
    expect(filterContacts(BOOK, "harbor", "all")).toHaveLength(1);
    expect(filterContacts(BOOK, "HARBOR", "all")).toHaveLength(1);
  });

  it("matches the contact person, the email, the phone and the city", () => {
    expect(filterContacts(BOOK, "maya", "all").map((c) => c.name)).toEqual([
      "Aurora Gemstone Supply Inc.",
    ]);
    expect(filterContacts(BOOK, "auroragems", "all")).toHaveLength(1);
    expect(filterContacts(BOOK, "555-0142", "all")).toHaveLength(1);
    expect(filterContacts(BOOK, "houston", "all")).toHaveLength(2);
  });

  it("treats missing fields as not matching rather than crashing", () => {
    // Harbor Metals has no email and no contact person; a search that reaches
    // into those fields must skip them, not throw on null.
    expect(filterContacts(BOOK, "orders@", "all").map((c) => c.name)).toEqual([
      "Aurora Gemstone Supply Inc.",
    ]);
  });

  it("trims the keyword, so a trailing space is not a different search", () => {
    expect(filterContacts(BOOK, "  harbor  ", "all")).toHaveLength(1);
  });

  it("narrows by active state in both directions", () => {
    expect(filterContacts(BOOK, "", "active")).toHaveLength(2);
    expect(filterContacts(BOOK, "", "inactive").map((c) => c.name)).toEqual(["Coastal Refinery"]);
  });

  it("composes the keyword with the active filter", () => {
    // Houston matches two rows, one inactive. Both narrowings apply at once.
    expect(filterContacts(BOOK, "houston", "active").map((c) => c.name)).toEqual([
      "Aurora Gemstone Supply Inc.",
    ]);
  });

  it("returns nothing when the keyword matches nothing", () => {
    expect(filterContacts(BOOK, "zzzzz", "all")).toEqual([]);
  });
});
