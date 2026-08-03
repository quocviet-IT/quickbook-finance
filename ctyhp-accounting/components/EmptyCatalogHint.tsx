"use client";
import Link from "next/link";
import { Typography } from "antd";

/**
 * Shown under a document's line items when the product catalog has nothing to
 * offer that picker.
 *
 * An empty item dropdown is indistinguishable from a missing feature -- the
 * first round of user testing read it as exactly that, and reported both "unit
 * price does not auto-populate" and "no product list exists" when the prefill
 * and the catalog were working the whole time. So say which screen holds the
 * catalog, and link it only for someone who can act on it: pointing a reader at
 * a screen they cannot edit is worse than telling them who can.
 */
export default function EmptyCatalogHint({
  canManage,
  children,
}: {
  /** Holds `items.manage`, so the catalog is theirs to fill. */
  canManage: boolean;
  /** The lead sentence, ending in a preposition the link completes. */
  children: string;
}) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {children}{" "}
      {canManage ? (
        <Link href="/items">Products &amp; Services</Link>
      ) : (
        <span>Products &amp; Services — ask whoever maintains it.</span>
      )}
    </Typography.Text>
  );
}
