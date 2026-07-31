import { describe, expect, it } from "vitest";
import {
  auditSequence,
  describeSequenceIntegrity,
  formatDocumentNumber,
  sequenceCsv,
  sequenceCsvFileName,
  totalUnexplained,
  unexplainedGaps,
  type SequenceDefinition,
  type SequenceDocument,
} from "@/lib/domain/sequence";

const INVOICES: SequenceDefinition = {
  sequence_key: "invoice",
  label: "Invoices",
  prefix: "INV-",
  next_value: 8,
};

function doc(value: number, overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    number_value: value,
    document_id: `doc-${value}`,
    document_date: "2026-07-01",
    document_status: "issued",
    ...overrides,
  };
}

describe("formatDocumentNumber", () => {
  it("pads to the six digits acc_next_number writes", () => {
    expect(formatDocumentNumber("INV-", 14)).toBe("INV-000014");
    expect(formatDocumentNumber("JE-", 1)).toBe("JE-000001");
    expect(formatDocumentNumber("INV-", 1234567)).toBe("INV-1234567");
  });
});

describe("auditSequence", () => {
  it("walks every issued number and marks the ones no document holds", () => {
    const audit = auditSequence({
      definition: INVOICES,
      documents: [doc(1), doc(2), doc(5), doc(6), doc(7)],
    });

    expect(audit.rows.map((row) => row.state)).toEqual([
      "present",
      "present",
      "missing",
      "missing",
      "present",
      "present",
      "present",
    ]);
    expect(audit.summary).toEqual({
      allocated: 7,
      present: 5,
      missing: 2,
      explained: 0,
      unexplained: 2,
      beyondSequence: 0,
      nextNumber: "INV-000008",
    });
    expect(unexplainedGaps(audit).map((row) => row.number)).toEqual([
      "INV-000003",
      "INV-000004",
    ]);
  });

  it("counts a gap somebody documented as explained, and keeps the reason with it", () => {
    const audit = auditSequence({
      definition: INVOICES,
      documents: [doc(1), doc(2), doc(5), doc(6), doc(7)],
      notes: [
        {
          number_value: 3,
          reason: "Removed with the July end-to-end test data",
          noted_at: "2026-07-31T02:00:00+00:00",
          noted_by_email: "admin@ctyhp.vn",
        },
      ],
    });

    expect(audit.summary.explained).toBe(1);
    expect(audit.summary.unexplained).toBe(1);
    expect(audit.rows[2].note?.reason).toBe("Removed with the July end-to-end test data");
    expect(unexplainedGaps(audit).map((row) => row.number)).toEqual(["INV-000004"]);
  });

  it("never attaches a note to a number a document still holds", () => {
    const audit = auditSequence({
      definition: INVOICES,
      documents: [doc(1)],
      notes: [{ number_value: 1, reason: "stale note about a live number", noted_at: "2026-07-31" }],
    });
    expect(audit.rows[0].note).toBeNull();
    expect(audit.summary.explained).toBe(0);
  });

  it("reports a document numbered above the counter instead of hiding it", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 3 },
      documents: [doc(1), doc(2), doc(9)],
    });

    expect(audit.summary.allocated).toBe(2);
    expect(audit.summary.beyondSequence).toBe(1);
    expect(audit.rows).toHaveLength(9);
    expect(audit.rows[8].state).toBe("beyond_sequence");
    // The numbers between the counter and the stray document are still missing.
    expect(audit.rows[2].state).toBe("missing");
  });

  it("reports a whole sequence as whole", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 4 },
      documents: [doc(1), doc(2), doc(3)],
    });
    expect(audit.summary.missing).toBe(0);
    expect(describeSequenceIntegrity(audit)).toBeNull();
  });

  it("handles a sequence that has never issued a number", () => {
    const audit = auditSequence({ definition: { ...INVOICES, next_value: 1 }, documents: [] });
    expect(audit.rows).toEqual([]);
    expect(audit.summary.allocated).toBe(0);
    expect(audit.summary.nextNumber).toBe("INV-000001");
  });
});

describe("describeSequenceIntegrity", () => {
  it("names the missing numbers and counts the rest", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 11 },
      documents: [doc(1), doc(10)],
    });
    expect(describeSequenceIntegrity(audit)).toBe(
      "8 numbers issued by the sequence are not on any document: INV-000002, " +
        "INV-000003, INV-000004, INV-000005, INV-000006 and 3 more.",
    );
  });

  it("reads as one number in the singular", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 3 },
      documents: [doc(1)],
    });
    expect(describeSequenceIntegrity(audit)).toBe(
      "1 number issued by the sequence is not on any document: INV-000002.",
    );
  });

  it("stays quiet when every gap has been accounted for", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 3 },
      documents: [doc(1)],
      notes: [{ number_value: 2, reason: "Voided draft removed before issue", noted_at: "2026-07-31" }],
    });
    expect(describeSequenceIntegrity(audit)).toBeNull();
  });

  it("still speaks up about a document ahead of the counter", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 2 },
      documents: [doc(1), doc(2)],
    });
    expect(describeSequenceIntegrity(audit)).toBe(
      "1 document is numbered above INV-000002, which the counter says has not been issued yet.",
    );
  });
});

describe("totalUnexplained", () => {
  it("adds unexplained gaps and stray numbers across every sequence", () => {
    const invoices = auditSequence({
      definition: INVOICES,
      documents: [doc(1), doc(2), doc(5), doc(6), doc(7)],
    });
    const journals = auditSequence({
      definition: { sequence_key: "journal_entry", label: "Journal entries", prefix: "JE-", next_value: 3 },
      documents: [doc(1), doc(2), doc(4)],
    });
    // Two missing invoice numbers, plus JE-000003 missing and JE-000004 stray.
    expect(totalUnexplained([invoices, journals])).toBe(4);
  });
});

describe("sequenceCsv", () => {
  it("lists every number in order and flags the breaks", () => {
    const audit = auditSequence({
      definition: { ...INVOICES, next_value: 4 },
      documents: [doc(1), doc(3, { document_status: "paid", document_date: "2026-07-02" })],
      notes: [{ number_value: 2, reason: "Test invoice removed by an administrator", noted_at: "2026-07-31" }],
    });

    expect(sequenceCsv(audit).split("\r\n")).toEqual([
      "Number,State,Date,Status,Document id,Documented reason",
      "INV-000001,On file,2026-07-01,issued,doc-1,",
      "INV-000002,MISSING,,,,Test invoice removed by an administrator",
      "INV-000003,On file,2026-07-02,paid,doc-3,",
    ]);
    expect(sequenceCsvFileName(audit)).toBe("number-sequence-invoice.csv");
  });
});
