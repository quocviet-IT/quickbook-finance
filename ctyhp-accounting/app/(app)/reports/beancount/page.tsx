import { redirect } from "next/navigation";

/**
 * Beancount moved to the sidebar's Accounting group (`/accounting/beancount`).
 * This address stays so an old link, a bookmark or an earlier release note
 * still lands on the page, with its query string.
 */
export default async function BeancountMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const rest = query.toString();
  redirect(rest ? `/accounting/beancount?${rest}` : "/accounting/beancount");
}
