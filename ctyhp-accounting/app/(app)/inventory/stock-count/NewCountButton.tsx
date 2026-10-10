"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { createStockCountAction } from "./actions";

/**
 * Opens the count that is still open, or starts a new one dated the company's
 * today with the previous count's lines copied in. The database decides which;
 * this only asks.
 */
export default function NewCountButton({ today, type = "primary" }: { today: string; type?: "primary" | "default" }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await createStockCountAction(today);
      if (res.ok && res.data) router.push(`/inventory/stock-count/${res.data.id}`);
      else message.error(res.error ?? "The count could not be started");
    } catch {
      message.error("The count could not be started. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type={type} icon={<PlusOutlined />} loading={busy} onClick={() => void start()}>
      New count
    </Button>
  );
}
