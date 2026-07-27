"use client";

import { Button, Tooltip, type ButtonProps } from "antd";

type IconActionButtonProps = Omit<ButtonProps, "aria-label" | "children" | "shape" | "title"> & {
  label: string;
};

/**
 * Compact table/form action with a visible tooltip and an accessible name.
 * Use only for familiar secondary actions; consequential accounting actions
 * keep their text labels so intent remains explicit.
 */
export default function IconActionButton({
  label,
  className,
  ...buttonProps
}: IconActionButtonProps) {
  return (
    <Tooltip title={label}>
      <span className="accounting-icon-action-wrap">
        <Button
          {...buttonProps}
          aria-label={label}
          className={`accounting-icon-action${className ? ` ${className}` : ""}`}
          shape="circle"
          size={buttonProps.size ?? "small"}
        />
      </span>
    </Tooltip>
  );
}
