import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { companyToday, getCurrentCompanySettings } from "@/lib/services/company";
import { listCurrencies } from "@/lib/services/reference";
import { readOpenItemStatement } from "@/lib/services/open-item-statement";
import { customerIdSchema } from "@/lib/domain/schemas";
import { buildOpenItemStatement, parseStatementAsOf } from "@/lib/domain/open-item-statement";
import type { DocumentCompany } from "@/lib/domain/invoice-document";
import PageHeader from "@/components/PageHeader";
import OpenItemStatementClient from "./OpenItemStatementClient";

export const dynamic = "force-dynamic";

/** The company block before the company has saved its settings, as the reports say it. */
const COMPANY_NOT_SET: DocumentCompany = {
  legal_name: "Company name not set",
  dba_name: null,
  address_line1: null,
  address_line2: null,
  city: null,
  region: null,
  postal_code: null,
  country: null,
};

/**
 * One customer's open-item statement (3.0.13): what they still owe on a day,
 * item by item and aged, as an A4 sheet to print, download or email.
 *
 * `?asOf=YYYY-MM-DD` picks the day; anything else, or nothing, is the
 * company's today.
 */
export default async function OpenItemStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // An id that is not one names no customer; asking the database would only
  // turn a wrong link into an error page.
  if (!customerIdSchema.safeParse(id).success) notFound();
  const sb = await createSupabaseServerClient();
  const today = await companyToday(sb);
  const asOf = parseStatementAsOf(query.asOf, today);
  const [found, settings, currencies] = await Promise.all([
    readOpenItemStatement(sb, id, asOf),
    getCurrentCompanySettings(sb),
    listCurrencies(sb),
  ]);
  if (!found) notFound();
  const { customer, items } = found;
  const base = currencies.find((currency) => currency.is_base);

  const statement = buildOpenItemStatement({
    asOf,
    today,
    company: settings ?? COMPANY_NOT_SET,
    customer,
    items,
    currencyCode: base?.code ?? "USD",
    decimals: base?.decimal_places ?? 2,
  });

  return (
    <div>
      <PageHeader
        title={`Statement for ${customer.name}`}
        breadcrumbItems={[
          { title: "Customers", href: "/customers" },
          { title: customer.name, href: `/customers/${id}` },
          { title: "Statement" },
        ]}
      />
      <OpenItemStatementClient key={asOf} statement={statement} customerId={id} />
    </div>
  );
}
