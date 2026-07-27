"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Grid, Tooltip } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { NEW_MENU } from "@/lib/domain/navigation";

/**
 * Create a document from anywhere. The forms are modals on their list pages, so
 * this navigates with `?new=1` and the page opens its own modal — no form is
 * duplicated here.
 */
export default function NewMenu() {
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const compact = screens.sm === false;
  const [pending, startTransition] = useTransition();
  const menu = (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: NEW_MENU.map((item) => ({ key: item.key, label: item.label })),
        onClick: ({ key }) => {
          const target = NEW_MENU.find((i) => i.key === key);
          if (target) startTransition(() => router.push(target.href));
        },
      }}
    >
      <Button
        type="primary"
        icon={<PlusOutlined />}
        loading={pending}
        shape={compact ? "circle" : "default"}
        aria-label={compact ? "Create new" : undefined}
        className="app-shell__new-button"
      >
        {!compact && (
          <>
            New <DownOutlined />
          </>
        )}
      </Button>
    </Dropdown>
  );
  return compact ? <Tooltip title="Create new">{menu}</Tooltip> : menu;
}
