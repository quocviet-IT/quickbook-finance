"use client";
import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";

/** Client-side Ant Design context: locale + App context for message/modal/notification. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={enUS}
      theme={{ token: { colorPrimary: "#0f766e", borderRadius: 6 } }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
