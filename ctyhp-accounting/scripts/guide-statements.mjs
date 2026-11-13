/**
 * The bank statements made up for the sample company Meridian (3.0.27), shared by
 * the step pictures (scripts/capture-step-shots.mjs) and the guide videos
 * (scripts/guide-videos/record.mjs). They agree with Meridian's own books for
 * January to March 2026, plus the lines only a bank would have added. They are
 * built here, in memory, and handed to a file chooser: no statement file is ever
 * read from disk.
 */

export const cents = (amount) => Math.round(amount * 100);
/** Where a statement closes; each month opens where the one before it closed, so the months join up. */
export const closingOf = ({ opening, lines }) => (cents(opening) + lines.reduce((sum, [, , amount]) => sum + cents(amount), 0)) / 100;

/** Each line is [date, description, amount], money in positive, as a bank download prints it. */
export const CHECKING_JANUARY = {
  // Opened on New Year's Day with the deposit the books record as their opening balance.
  opening: 0,
  lines: [
    ["2026-01-01", "OPENING DEPOSIT", 30000],
    ["2026-01-08", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-01-12", "DEPOSIT NORTHWIND ANALYTICS RCV-1001", 32000],
    ["2026-01-15", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-01-28", "PACIFIC POWER AUTOPAY", -540],
  ],
};
export const CHECKING_FEBRUARY = {
  opening: closingOf(CHECKING_JANUARY),
  lines: [
    ["2026-02-02", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-02-06", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-02-10", "FIBERLINK COMMUNICATIONS", -260],
    // Taken twice: the books hold one, so the second is held back as already booked.
    ["2026-02-11", "FIBERLINK COMMUNICATIONS", -260],
    ["2026-02-14", "PAYROLL SEMI-MONTHLY", -15725],
    // The books missed February's instalment: offered as a loan payment, to split.
    ["2026-02-16", "FIRST NATIONAL LOAN PMT", -1650],
    ["2026-02-24", "DEPOSIT HARBOR LOGISTICS RCV-1002", 12000],
    ["2026-02-27", "APEX INSURANCE PREMIUM", -7200],
    ["2026-02-28", "MONTHLY SERVICE FEE", -25],
  ],
};
export const CHECKING_MARCH = {
  opening: closingOf(CHECKING_FEBRUARY),
  lines: [
    ["2026-03-02", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-03-02", "METRO REALTY PARTNERS RENT", -4200],
    // Charged twice in two days: the Banking overview's possible duplicate.
    ["2026-03-04", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-03-05", "COUNTER DEPOSIT", 9800],
    ["2026-03-09", "CHECK 2210 STERLING & CO CPAS", -3500],
    ["2026-03-13", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-03-16", "FIRST NATIONAL LOAN PMT", -1680],
    ["2026-03-20", "OFFICE DEPOT #1123", -86.4],
    ["2026-03-27", "ACCOUNT SERVICE CHARGES", -75],
    ["2026-03-30", "DEPOSIT BLUERIDGE FOODS RCV-1003", 16800],
    ["2026-03-31", "OWNER DISTRIBUTION", -5000],
    ["2026-03-31", "IRS USATAXPYMT", -8325],
  ],
};
/** Only ever previewed in the import dialog, never imported. */
export const CHECKING_APRIL = {
  opening: closingOf(CHECKING_MARCH),
  lines: [
    ["2026-04-01", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-04-03", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-04-10", "FIBERLINK COMMUNICATIONS", -260],
    ["2026-04-14", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-04-16", "FIRST NATIONAL LOAN PMT", -1650],
    ["2026-04-22", "DEPOSIT NORTHWIND ANALYTICS", 18500],
    ["2026-04-30", "MONTHLY SERVICE FEE", -25],
  ],
};
/** Savings has never been reconciled; the books reach this statement's opening exactly. */
export const SAVINGS_MARCH = {
  opening: 25085,
  lines: [["2026-03-31", "INTEREST PAYMENT", 86.2]],
};

export const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/**
 * A bank download: date, description, amount and the running balance. `leaveOut`
 * drops one line from the file while its balance still counts, which is a
 * statement that does not add up. `misread` adds a line that is not a
 * transaction at the end (a total read from the statement's summary, 3.0.28):
 * the balance does not move for it, so the statement is out by exactly its
 * amount until it is ticked Not a transaction.
 */
export function statementCsv({ opening, lines }, { leaveOut = -1, misread = null } = {}) {
  let balance = cents(opening);
  const rows = ["Date,Description,Amount,Balance"];
  lines.forEach(([date, description, amount], index) => {
    balance += cents(amount);
    if (index === leaveOut) return;
    rows.push([usDate(date), `"${description}"`, amount.toFixed(2), (balance / 100).toFixed(2)].join(","));
  });
  if (misread) {
    const [date, description, amount] = misread;
    rows.push([usDate(date), `"${description}"`, amount.toFixed(2), (balance / 100).toFixed(2)].join(","));
  }
  return { csv: `${rows.join("\n")}\n`, closing: balance / 100 };
}

export const statementFile = (name, statement, options) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(statementCsv(statement, options).csv, "utf8"),
});
