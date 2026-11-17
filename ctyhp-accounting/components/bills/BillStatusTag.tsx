import StatusTag from "@/components/ui/StatusTag";
import { billAttention, type AttentionBill } from "@/lib/domain/bill-attention";
import { documentAttentionLook } from "@/lib/domain/invoice-attention";
import { PAID_LABELS } from "@/lib/domain/status-label";

interface Props {
  bill: AttentionBill;
  /** The company's today, which "late" and "due in" count from. */
  today: string;
}

/**
 * The Bills list's Status cell (3.0.44): "201 days late" in red, "Due in 5
 * days" in amber, and otherwise the bill's own status (Draft, Open, Paid…),
 * in the same words and tones as the invoice list's.
 */
export function BillStatusTag({ bill, today }: Props) {
  const look = documentAttentionLook(billAttention(bill, today));
  if (look) {
    const code = look.tone === "danger" ? "overdue" : "due_soon";
    return <StatusTag status={code} looks={{ [code]: look }} />;
  }
  return <StatusTag status={bill.status} labels={PAID_LABELS} />;
}
