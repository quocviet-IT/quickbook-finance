"use client";
import { useRef } from "react";
import type { FormInstance } from "antd";
import type { VendorRow } from "@/lib/db/types";
import { defaultIn, lineExpenseDefault, refillLineAccounts } from "@/lib/domain/posting-defaults";

/**
 * The expense account a bill or expense line starts on (3.01): the vendor's
 * own default once a vendor is chosen, otherwise the company's.
 *
 * Choosing a vendor moves the lines the form filled itself (empty ones, and
 * ones still on a default it put there) to that vendor's account; a line
 * somebody set by hand keeps theirs. A line added afterwards starts on the
 * account the last choice settled on.
 */
export function useLineAccountDefault({
  form,
  vendors,
  companyDefault,
  choices,
}: {
  form: FormInstance;
  vendors: readonly Pick<VendorRow, "id" | "default_expense_account_id">[];
  companyDefault: string | null;
  choices: readonly { id: string }[];
}) {
  const company = defaultIn(companyDefault, choices);
  const current = useRef<string | undefined>(company);

  return {
    /** For the form's first line. */
    initialLineAccount: company,
    /** For a line added with Add line. */
    newLineAccount: () => current.current,
    onVendorChange(vendorId: string | undefined) {
      const vendor = vendors.find((v) => v.id === vendorId);
      const next = lineExpenseDefault(vendor?.default_expense_account_id, companyDefault, choices);
      const lines = (form.getFieldValue("lines") ?? []) as Record<string, unknown>[];
      form.setFieldValue("lines", refillLineAccounts(lines, "expense_account_id", [company, current.current], next));
      if (next) current.current = next;
    },
    /** After the form is reset for the next document. */
    reset() {
      current.current = company;
    },
  };
}
