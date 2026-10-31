"use server";
import { revalidatePath } from "next/cache";
import { z } from "@/lib/zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import {
  CASH_COUNT_MEMO_MAX,
  CASH_OVER_AND_SHORT_CODE,
  cashCountMessage,
  cashVariance,
  type CashCountRow,
  type CashStanding,
} from "@/lib/domain/cash-count";
import { listAccounts } from "@/lib/services/accounts";
import {
  cashCountNeedsApproval,
  getCashBook,
  getCashStanding,
  listCashCounts,
  postCashCount,
} from "@/lib/services/cash-count";
import { companyClock } from "@/lib/services/report-context";
import { formatMoney } from "@/lib/format";
import { listCurrencies } from "@/lib/services/reference";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const NO_PERMISSION = "You do not have permission to count cash";

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of the count");

/** What the dialog needs before it opens: the company's day and the accounts a difference can go to. */
export interface CashCountOptions {
  today: string;
  offsetAccounts: { id: string; code: string; name: string }[];
  /** The id of account 7510 when the company has it and it can be posted to; null otherwise. */
  defaultOffsetId: string | null;
}

export async function cashCountOptionsAction(): Promise<ActionResult<CashCountOptions>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  try {
    const sb = await createSupabaseServerClient();
    const [accounts, { today }] = await Promise.all([listAccounts(sb), companyClock(sb)]);
    const offsetAccounts = accounts
      .filter((a) => a.status === "active" && a.is_posting_account)
      .map((a) => ({ id: a.id, code: a.account_code, name: a.name }))
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }) || a.id.localeCompare(b.id));
    const standard = offsetAccounts.find((a) => a.code === CASH_OVER_AND_SHORT_CODE);
    return { ok: true, data: { today, offsetAccounts, defaultOffsetId: standard?.id ?? null } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

const previewSchema = z.object({
  accountId: z.guid(),
  date: isoDate,
  countedMinor: z.number().int().nonnegative().nullable(),
});

export interface CashCountPreview {
  bookMinor: number;
  /** True when the policy would make a count with this amount wait for approval; false when no amount was given. */
  waits: boolean;
}

/** The book balance at the chosen date and, once an amount is typed, whether the count would wait for approval. */
export async function cashCountPreviewAction(raw: unknown): Promise<ActionResult<CashCountPreview>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const bookMinor = await getCashBook(sb, parsed.data.accountId, parsed.data.date);
    const waits =
      parsed.data.countedMinor === null
        ? false
        : await cashCountNeedsApproval(sb, cashVariance(parsed.data.countedMinor, bookMinor));
    return { ok: true, data: { bookMinor, waits } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

const postSchema = z.object({
  accountId: z.guid(),
  date: isoDate,
  countedMinor: z.number().int().nonnegative(),
  offsetAccountId: z.guid("Choose the account the difference goes to"),
  memo: z.string().max(CASH_COUNT_MEMO_MAX, `The memo is too long (${CASH_COUNT_MEMO_MAX} characters at most)`),
});

/** Record a count. The message names the entry, says the count waits for approval, or says there was no difference. */
export async function postCashCountAction(raw: unknown): Promise<ActionResult<{ message: string }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const [{ result, entryNumber }, currencies] = await Promise.all([
      postCashCount(sb, {
        accountId: parsed.data.accountId,
        countedOn: parsed.data.date,
        countedMinor: parsed.data.countedMinor,
        offsetAccountId: parsed.data.offsetAccountId,
        memo: parsed.data.memo,
      }),
      listCurrencies(sb),
    ]);
    const base = currencies.find((c) => c.is_base);
    const money = (minor: number) => formatMoney(minor, base?.code ?? "USD", base?.decimal_places ?? 2);
    revalidatePath("/accounts");
    revalidatePath("/reports");
    return { ok: true, data: { message: cashCountMessage(result, entryNumber, money) } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

/** One account's counts, newest first. */
export async function cashCountsAction(accountId: unknown): Promise<ActionResult<CashCountRow[]>> {
  if (!(await getUserRole())) return { ok: false, error: "Not authorized" };
  const parsed = z.guid().safeParse(accountId);
  if (!parsed.success) return { ok: false, error: "Choose the cash account" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listCashCounts(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

/** The Balance Sheet panel's cash lines at its end date, and whether this person may count. */
export async function cashStandingAction(asOf: unknown): Promise<ActionResult<{ lines: CashStanding[]; canCount: boolean }>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  const parsed = isoDate.safeParse(asOf);
  if (!parsed.success) return { ok: false, error: "The date is not valid" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { lines: await getCashStanding(sb, parsed.data), canCount: canWrite(role) } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}
