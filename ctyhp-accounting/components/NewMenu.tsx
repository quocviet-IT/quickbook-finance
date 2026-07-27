"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Tooltip } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { NEW_MENU } from "@/lib/domain/navigation";

/**
 * Create a document from anywhere. The forms are modals on their list pages, so
 * this navigates with `?new=1` and the page opens its own modal — no form is
 * duplicated here.
 */
export default function NewMenu() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Tooltip title="Create new">
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
          aria-label="Create new"
          className="app-shell__new-button"
        >
          <span className="app-shell__new-label">New</span>
          <DownOutlined className="app-shell__new-chevron" />
        </Button>
      </Dropdown>
    </Tooltip>
  );
}
