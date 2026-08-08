"use client";
import { Alert, Space } from "antd";
import type { Dayjs } from "dayjs";
import type { ImportTarget } from "@/lib/domain/import-mapping";
import type { ImportPreview } from "@/lib/services/data-import";

export interface ImportConfirmContentProps {
  target: ImportTarget;
  preview: ImportPreview;
  /** Whether this run also brings opening balances across. */
  balances: boolean;
  isSampleCompany: boolean;
  money: (minor: number) => string;
  asOf: Dayjs;
}

/**
 * The last thing read before an import happens.
 *
 * Lifted out of `ImportClient` so it can be read on its own, and because what
 * it says has to be true of the tab it is shown on. It told every tab but one
 * "Lists only. Nothing is posted to the ledger." — which is a fair description
 * of importing a customer list and a false one of importing 1,467 transactions,
 * where every row posts an entry. It sat in front of an accountant doing
 * exactly that, on live books.
 */
export default function ImportConfirmContent({
  target,
  preview,
  balances,
  isSampleCompany,
  money,
  asOf,
}: ImportConfirmContentProps) {
  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <div>
        {preview.creates} to create, {preview.updates} to update.
      </div>
      {target === "transactions" && preview.moneyInMinor !== undefined ? (
        // The figures the reader confirms against. A single net number hides a
        // sign column read the wrong way round; these two do not.
        <div>
          <b>{money(preview.moneyInMinor)}</b> in, <b>{money(preview.moneyOutMinor ?? 0)}</b> out
          {" — a net of "}
          <b>{money(preview.openingTotalMinor)}</b>.
        </div>
      ) : null}
      {balances ? (
        <Alert
          type="warning"
          showIcon
          message="This also posts to the ledger"
          description={
            <>
              Opening balances of <b>{money(preview.openingTotalMinor)}</b> will be brought
              across as of {asOf.format("YYYY-MM-DD")}. Opening balances can only be brought
              across once — a second attempt is refused rather than doubling the books.
            </>
          }
        />
      ) : target === "transactions" ? (
        <Alert
          type="warning"
          showIcon
          message="This posts to the ledger"
          description="Each row posts one journal entry and one matched bank line. It is recorded as an import, so it can be undone from the list below."
        />
      ) : (
        <Alert type="info" showIcon message="Lists only. Nothing is posted to the ledger." />
      )}
      {!isSampleCompany ? (
        <Alert
          type="error"
          showIcon
          message="These are live books"
          description="Not a sample company. Imported documents cannot be deleted afterwards."
        />
      ) : null}
    </Space>
  );
}
