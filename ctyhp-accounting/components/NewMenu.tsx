"use client";
import { useRouter } from "next/navigation";
import { Button, Dropdown } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { NEW_MENU } from "@/lib/domain/navigation";

/**
 * Create a document from anywhere. The forms are modals on their list pages, so
 * this navigates with `?new=1` and the page opens its own modal — no form is
 * duplicated here.
 */
export default function NewMenu() {
  const router = useRouter();
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: NEW_MENU.map((item) => ({ key: item.key, label: item.label })),
        onClick: ({ key }) => {
          const target = NEW_MENU.find((i) => i.key === key);
          if (target) router.push(target.href);
        },
      }}
    >
      <Button type="primary" icon={<PlusOutlined />} className="app-shell__new-button">
        New <DownOutlined />
      </Button>
    </Dropdown>
  );
}
