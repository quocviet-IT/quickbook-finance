"use client";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import { antdThemeTokens } from "@/lib/design/tokens";
import { useTheme } from "@/components/theme/ThemeProvider";

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
 *
 * The theme comes from ThemeProvider above, and both halves have to move
 * together: `darkAlgorithm` recolours every Ant Design component, while the
 * tokens recolour everything the stylesheet draws. One without the other is
 * the half-converted app this whole piece of work exists to avoid.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { token, components } = antdThemeTokens(theme);
  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        algorithm: theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { ...token, borderRadius: 8, fontFamily: SANS, fontSize: 14, wireframe: false },
        components: {
          ...components,
          // The tokens give Layout its colours; the header's height is a
          // dimension, so it stays here with the other non-colour settings
          // rather than moving into a module that governs colour alone.
          // Spreading over components.Layout keeps those colours.
          Layout: { ...components.Layout, headerHeight: 56 },
          Card: { borderRadiusLG: 12 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
