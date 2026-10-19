"use client";

import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

/** What the ⋮ button says when pointed at: the same words on every list. */
export const MORE_ACTIONS = "More actions";

/**
 * The ⋮ at the end of a row: the row's other actions, in a menu.
 *
 * The UI review of 2026-10-19 found it on six lists as three bare dots. A
 * screen reader heard "Actions for INV-0042"; everyone else saw an icon and
 * had to click it to learn what it was. It now says "More actions" when
 * pointed at, as every button that is only an icon must.
 */
export default function RowActionsMenu({
  items,
  label,
  loading,
  minWidth = 148,
}: {
  items: MenuProps["items"];
  /** What a screen reader hears, naming the row: "Actions for INV-0042". */
  label: string;
  loading?: boolean;
  minWidth?: number;
}) {
  return (
    <Dropdown menu={{ items, style: { minWidth } }} trigger={["click"]}>
      <Tooltip title={MORE_ACTIONS}>
        <Button size="small" icon={<MoreOutlined />} loading={loading} aria-label={label} />
      </Tooltip>
    </Dropdown>
  );
}
