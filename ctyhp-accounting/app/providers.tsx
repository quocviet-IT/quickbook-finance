"use client";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import { antdThemeTokens } from "@/lib/design/tokens";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * App-wide Ant Design context: English locale, a disciplined enterprise theme
 * (teal primary, slate chrome), and App context for message/modal.
 * Uses a native font stack — zero web-font requests keeps first paint fast.
 *
 * Every colour comes from lib/design/tokens.ts. A literal here would be a
 * second source of truth for a colour the rest of the app reads from there,
 * and a unit test refuses one.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const { token, components } = antdThemeTokens();
  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: { ...token, borderRadius: 8, fontFamily: SANS, fontSize: 14, wireframe: false },
        components: { ...components, Card: { borderRadiusLG: 12 } },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
