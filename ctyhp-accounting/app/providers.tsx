"use client";
import { App, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";

/** Client-side Ant Design context: locale + App context for message/modal/notification. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={viVN}
      theme={{ token: { colorPrimary: "#0f766e", borderRadius: 6 } }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
