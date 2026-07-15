"use client";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * App-wide Ant Design context: English locale, a disciplined enterprise theme
 * (teal primary, slate chrome), and App context for message/modal.
 * Uses a native font stack — zero web-font requests keeps first paint fast.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#0f766e",
          colorInfo: "#0f766e",
          colorSuccess: "#15803d",
          colorWarning: "#b45309",
          colorError: "#b91c1c",
          colorBgLayout: "#f6f7f9",
          colorTextHeading: "#0f172a",
          borderRadius: 8,
          fontFamily: SANS,
          fontSize: 14,
          wireframe: false,
        },
        components: {
          Layout: {
            siderBg: "#0f172a",
            triggerBg: "#0b1220",
            headerBg: "#ffffff",
            headerHeight: 56,
          },
          Menu: {
            darkItemBg: "#0f172a",
            darkSubMenuItemBg: "#0f172a",
            darkItemSelectedBg: "#0f766e",
            darkItemColor: "#cbd5e1",
            darkItemHoverBg: "#1e293b",
          },
          Table: {
            headerBg: "#f1f5f9",
            headerColor: "#334155",
            borderColor: "#eef2f6",
          },
          Card: { borderRadiusLG: 12 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
