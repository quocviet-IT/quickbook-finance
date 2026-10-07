import { describe, expect, it } from "vitest";
import {
  keepFailureMessage,
  unlinkedFileMessage,
  linesSpan,
  shortSha,
  statementFileAccount,
  statementFileAttachSchema,
  statementFileKeepSchema,
  statementFileMime,
  statementFileMismatch,
  statementFileRefusal,
  statementFileSpan,
  statementFileTitle,
  type EvidenceTarget,
} from "@/lib/domain/statement-evidence";

const money = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

describe("statementFileMime", () => {
  it("keeps a PDF as a PDF and a CSV as a CSV", () => {
    expect(statementFileMime("may.pdf")).toBe("application/pdf");
    expect(statementFileMime("MAY.PDF")).toBe("application/pdf");
    expect(statementFileMime("may.csv")).toBe("text/csv");
  });

  it("keeps every bank download as text, whatever type the browser gave it", () => {
    for (const name of ["a.ofx", "a.qfx", "a.qbo", "a.qif", "A.QFX"]) {
      expect(statementFileMime(name, "application/vnd.intu.qfx")).toBe("text/plain");
    }
  });

  it("falls back to the browser's type only when it is one the store keeps", () => {
    expect(statementFileMime("statement", "application/pdf")).toBe("application/pdf");
    expect(statementFileMime("statement", "application/x-msdownload")).toBeNull();
    expect(statementFileMime("statement.xlsx")).toBeNull();
  });
});

describe("statementFileRefusal", () => {
  it("lets a statement file through", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 2048 })).toBeNull();
  });

  it("says why a file cannot be kept", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 0 })).toBe("the file is empty");
    expect(statementFileRefusal({ name: "may.pdf", size: 10_485_761 })).toBe("it is larger than 10 MB");
    expect(statementFileRefusal({ name: `${"x".repeat(252)}.pdf`, size: 1 })).toBe("its name is longer than 255 characters");
    expect(statementFileRefusal({ name: "may.xlsx", size: 1 })).toBe("OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files");
  });

  it("allows exactly 10 MB", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 10_485_760 })).toBeNull();
  });
});

describe("statementFileSpan and linesSpan", () => {
  it("runs from the earliest first day to the latest last day", () => {
    expect(
      statementFileSpan([
        { from: "2026-06-01", to: "2026-06-30" },
        { from: "2026-04-01", to: "2026-04-30" },
        { from: null, to: "2026-05-31" },
      ]),
    ).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("is empty when nothing printed a period", () => {
    expect(statementFileSpan([{ from: null, to: null }])).toEqual({ from: null, to: null });
    expect(linesSpan([])).toEqual({ from: null, to: null });
  });

  it("takes a file of lines from its first to its last date", () => {
    expect(linesSpan([{ txn_date: "2026-05-09" }, { txn_date: "2026-05-02" }, { txn_date: "2026-05-30" }])).toEqual({
      from: "2026-05-02",
      to: "2026-05-30",
    });
  });
});

describe("statementFileAccount", () => {
  it("names the bank and the account's last digits", () => {
    expect(statementFileAccount("Example Bank", "****1183")).toBe("Example Bank ****1183");
  });

  it("leaves out a number the account does not have", () => {
    expect(statementFileAccount(" Operating ", null)).toBe("Operating");
  });
});

describe("statementFileTitle", () => {
  it("names the account and the statement's period", () => {
    expect(statementFileTitle("Example Bank ****1183", { from: "2026-05-01", to: "2026-05-31" })).toBe(
      "Example Bank ****1183 — statement May 1 – May 31, 2026",
    );
  });

  it("names a statement that printed only its closing day", () => {
    expect(statementFileTitle("Example Bank", { from: null, to: "2026-05-31" })).toBe(
      "Example Bank — statement closing May 31, 2026",
    );
  });

  it("still has a title when no period was read", () => {
    expect(statementFileTitle("  ", { from: null, to: null })).toBe("Bank account — statement file");
  });

  it("fits the store's 200 characters", () => {
    expect(statementFileTitle("x".repeat(300), { from: null, to: null })).toHaveLength(200);
  });
});

describe("shortSha", () => {
  it("prints the first 12 characters", () => {
    expect(shortSha("0123456789abcdef".repeat(4))).toBe("0123456789ab");
  });
});

describe("keepFailureMessage", () => {
  it("points a reconciliation to Attach the statement", () => {
    expect(keepFailureMessage("it is larger than 10 MB", "reconciliation")).toBe(
      "The statement file could not be kept: it is larger than 10 MB. Attach it on the reconciliation.",
    );
  });

  it("says an import went on without its file", () => {
    expect(keepFailureMessage("Failed to fetch.", "import")).toBe(
      "The statement file could not be kept: Failed to fetch. Its lines were imported without it.",
    );
  });

  it("never prints an empty reason", () => {
    expect(keepFailureMessage("  ", "import")).toBe(
      "The statement file could not be kept: an unexpected error occurred. Its lines were imported without it.",
    );
  });
});

describe("unlinkedFileMessage", () => {
  it("says an import's file is kept, and where to find it", () => {
    expect(unlinkedFileMessage("permission denied.", "import")).toBe(
      "The statement file was kept but could not be tied to this import: permission denied. It is in Reports › Saved.",
    );
  });

  it("points a reconciliation to Attach the statement", () => {
    expect(unlinkedFileMessage("", "reconciliation")).toBe(
      "The statement file was kept but could not be tied to this reconciliation: an unexpected error occurred. Attach it on the reconciliation.",
    );
  });
});

describe("statementFileMismatch", () => {
  const MAY: EvidenceTarget = {
    endingDate: "2026-05-31",
    endingMinor: 616001,
    keptLines: [
      { txn_date: "2026-05-04", amount_minor: -1200 },
      { txn_date: "2026-05-15", amount_minor: 50000 },
    ],
  };

  it("matches the statement it was reconciled against", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toBeNull();
  });

  it("refuses another month's statement, saying both", () => {
    const read = { to: "2026-06-30", closingMinor: 659501, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This file's statement closes Jun 30, 2026 at $6,595.01; this reconciliation is to May 31, 2026 at $6,160.01.",
    );
  });

  it("refuses a statement of the same day that closes at another balance", () => {
    const read = { to: "2026-05-31", closingMinor: 616000, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toMatch(/closes May 31, 2026 at \$6,160\.00; this reconciliation is to May 31, 2026 at \$6,160\.01/);
  });

  it("refuses a statement whose lines differ, naming the first that does", () => {
    const read = {
      to: "2026-05-31",
      closingMinor: 616001,
      lines: [
        { txn_date: "2026-05-04", amount_minor: -1500 },
        { txn_date: "2026-05-15", amount_minor: 50000 },
      ],
    };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "Line 1 differs: the file has May 4, 2026 at -$15.00; this reconciliation kept May 4, 2026 at -$12.00.",
    );
  });

  it("refuses a statement with a line more or less", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines.slice(0, 1) };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This reconciliation kept 2 lines from May 4, 2026 to May 31, 2026; this file has 1 line in those days.",
    );
  });

  it("ignores a line of no amount, which was never kept", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: [...MAY.keptLines, { txn_date: "2026-05-20", amount_minor: 0 }] };
    expect(statementFileMismatch(read, MAY, money)).toBeNull();
  });

  it("matches a bank download that prints no balance by its lines alone", () => {
    expect(statementFileMismatch({ to: null, closingMinor: null, lines: MAY.keptLines }, MAY, money)).toBeNull();
  });

  it("matches the month of a CSV that runs over several months", () => {
    const lines = [
      { txn_date: "2026-04-28", amount_minor: 700 },
      ...MAY.keptLines,
      { txn_date: "2026-06-02", amount_minor: -300 },
    ];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toBeNull();
  });

  it("refuses a bank download whose lines are not the kept ones", () => {
    const lines = [{ txn_date: "2026-05-04", amount_minor: -1200 }];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toMatch(/; this file has 1 line in those days\.$/);
  });

  it("needs a closing balance when the reconciliation kept no lines", () => {
    const byHand: EvidenceTarget = { ...MAY, keptLines: [] };
    expect(statementFileMismatch({ to: null, closingMinor: null, lines: MAY.keptLines }, byHand, money)).toBe(
      "This file does not show the statement's closing balance, so it cannot be matched to this reconciliation. Attach the bank's PDF statement for May 31, 2026.",
    );
    expect(statementFileMismatch({ to: "2026-05-31", closingMinor: 616001, lines: [] }, byHand, money)).toBeNull();
  });
});

describe("statementFileKeepSchema", () => {
  const valid = {
    title: "Example Bank — statement May 1 – May 31, 2026",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    file_name: "may.pdf",
    storage_path: "co_example/aaaabbbb-cccc-4ddd-8eee-ffff00001111.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    sha256: "a".repeat(64),
  };

  it("accepts a statement file", () => {
    expect(statementFileKeepSchema.safeParse(valid).success).toBe(true);
    expect(statementFileKeepSchema.safeParse({ ...valid, mime_type: "text/plain" }).success).toBe(true);
  });

  it("refuses a type the store does not keep for statements, a bad digest, and a period backwards", () => {
    expect(statementFileKeepSchema.safeParse({ ...valid, mime_type: "image/png" }).success).toBe(false);
    expect(statementFileKeepSchema.safeParse({ ...valid, sha256: "xyz" }).success).toBe(false);
    expect(statementFileKeepSchema.safeParse({ ...valid, period_start: "2026-06-01" }).success).toBe(false);
  });
});

describe("statementFileAttachSchema", () => {
  it("accepts what was read and refuses a line without a whole amount", () => {
    const base = {
      reconciliation_id: "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
      file_id: "bbbbcccc-dddd-4eee-8fff-000011112222",
      to: "2026-05-31",
      closing_minor: 616001,
      lines: [{ txn_date: "2026-05-04", amount_minor: -1200 }],
    };
    expect(statementFileAttachSchema.safeParse(base).success).toBe(true);
    expect(statementFileAttachSchema.safeParse({ ...base, lines: [{ txn_date: "2026-05-04", amount_minor: 1.5 }] }).success).toBe(false);
  });
});
