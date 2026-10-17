/**
 * How a stored status reads on screen: one word or phrase, first letter
 * capitalized, and the tone it is shown in.
 *
 * The UI review of 2026-10-17 found statuses printed as the database keeps
 * them, "open", "received", "void", "stock_count", "not enrolled", beside
 * screens that said "Open" and "Partially paid". Each screen had its own colour
 * map and most printed the code itself.
 *
 * The codes belong to different domains and will never be one enum, so this
 * is not a list of every status. It is the shared reading: a code that means
 * the same thing everywhere (posted, void, draft, paid) looks the same
 * everywhere, a screen overrides only what its own domain means differently
 * ("partial" is partly paid on a bill and partly received on a purchase
 * order), and a code nobody has named still reads as words, never as a code.
 *
 * Pure, so CSV exports, sentences and select options say exactly what the tag
 * says. components/ui/StatusTag.tsx draws it.
 */

/** The five tones of lib/design/tone.tsx, named here so this module stays free of React. */
export type StatusTone = "positive" | "neutral" | "warning" | "danger" | "muted";

export interface StatusLook {
  tone: StatusTone;
  label: string;
}

/** Words that keep their capitals, or their punctuation, inside a label. */
const SPELLED: Record<string, string> = {
  ach: "ACH",
  ai: "AI",
  id: "ID",
  gl: "GL",
  w9: "W-9",
  csv: "CSV",
  pdf: "PDF",
};

/**
 * A code as a reader says it: `not_requested` → "Not requested",
 * `in_progress` → "In progress", `ach` → "ACH". Sentence case, so a two-word
 * status reads like the rest of the screen's words. An empty code is a dash.
 */
export function humanizeStatus(code: string | null | undefined): string {
  if (!code) return "—";
  const words = code.trim().replaceAll("_", " ").replaceAll("-", " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .map((word, index) => {
      const spelled = SPELLED[word.toLowerCase()];
      if (spelled) return spelled;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const look = (tone: StatusTone, label: string): StatusLook => ({ tone, label });

/**
 * The codes that mean one thing wherever they appear, with how they look.
 *
 * Tones follow what the reader should do: positive is finished and in the
 * books, neutral is under way, warning wants a look, danger is wrong, muted is
 * off the books or out of use. Draft and void share the muted tone and are told
 * apart by their icons (StatusTag), as lib/design/status.tsx set out.
 */
const SHARED: Record<string, StatusLook> = {
  // Documents and entries
  draft: look("muted", "Draft"),
  open: look("neutral", "Open"),
  issued: look("neutral", "Issued"),
  partial: look("warning", "Partial"),
  paid: look("positive", "Paid"),
  unapplied: look("neutral", "Unapplied"),
  applied: look("positive", "Applied"),
  posted: look("positive", "Posted"),
  void: look("muted", "Void"),
  reversed: look("muted", "Reversed"),
  received: look("positive", "Received"),
  closed: look("muted", "Closed"),
  // The stored code keeps its double l; the screen spells it the American way.
  cancelled: look("muted", "Canceled"),
  overdue: look("danger", "Overdue"),
  // Work and approvals
  pending: look("warning", "Pending"),
  waiting: look("warning", "Waiting"),
  approved: look("positive", "Approved"),
  rejected: look("danger", "Rejected"),
  in_progress: look("neutral", "In progress"),
  completed: look("positive", "Completed"),
  acknowledged: look("neutral", "Acknowledged"),
  dismissed: look("muted", "Dismissed"),
  recorded: look("positive", "Recorded"),
  // Things that are in use or not
  active: look("positive", "Active"),
  inactive: look("muted", "Inactive"),
  archived: look("muted", "Archived"),
  disconnected: look("muted", "Disconnected"),
  attention_required: look("warning", "Needs attention"),
  // Files and runs
  stored: look("positive", "Stored"),
  skipped: look("muted", "Skipped"),
  failed: look("danger", "Failed"),
  missing: look("danger", "Missing"),
  // Tax forms and sign-in
  not_requested: look("muted", "Not requested"),
  requested: look("neutral", "Requested"),
  on_file: look("positive", "On file"),
  expired: look("warning", "Expired"),
  enrolled: look("positive", "Enrolled"),
  not_enrolled: look("warning", "Not enrolled"),
  not_required: look("muted", "Not required"),
};

/** What "partial" means on a sales invoice or a bill. */
export const PAID_LABELS: Readonly<Record<string, string>> = { partial: "Partially paid" };
/** What "partial" means on a credit memo, a vendor credit or a payment. */
export const APPLIED_LABELS: Readonly<Record<string, string>> = { partial: "Partially applied" };
/** What "partial" means on a purchase order. */
export const RECEIVED_LABELS: Readonly<Record<string, string>> = { partial: "Partially received" };

export interface StatusOverrides {
  /** A screen's own looks for codes its domain reads differently, tone and label together. */
  looks?: Readonly<Record<string, StatusLook>>;
  /** A screen's own words for codes whose tone is the shared one. */
  labels?: Readonly<Record<string, string>>;
}

/** How a code looks: the screen's own look, else the shared one with the screen's word, else words in the muted tone. */
export function statusLook(code: string | null | undefined, overrides: StatusOverrides = {}): StatusLook {
  if (!code) return look("muted", "—");
  const own = overrides.looks?.[code];
  if (own) return own;
  const shared = SHARED[code];
  return {
    tone: shared?.tone ?? "muted",
    label: overrides.labels?.[code] ?? shared?.label ?? humanizeStatus(code),
  };
}

/** The label alone, for a sentence, a select option or an export cell. */
export function statusLabel(code: string | null | undefined, overrides: StatusOverrides = {}): string {
  return statusLook(code, overrides).label;
}
