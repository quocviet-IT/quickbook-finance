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
        /*
         * One variable scope per theme, and this is not a nicety.
         *
         * Ant Design v6 renders its component tokens as CSS variables and
         * names the block after a key it derives itself — the same key for
         * both themes. So the light block the server emits and the dark block
         * the client emits land on the *identical* selector
         * (`.css-var-…​.ant-table-css-var`), at identical specificity, and the
         * one inserted last wins.
         *
         * Which one that is varies by page. Measured: on /banking the dark
         * block came second and the table header was the dark surface; on
         * /settings/audit the light block came second and the same header was
         * the light one — with `data-theme` dark and every one of our own
         * variables resolving correctly. Six routes were wrong and fifty were
         * right, for no reason visible in any stylesheet.
         *
         * Distinct keys give the two themes distinct selectors, so they stop
         * overwriting each other and insertion order stops mattering.
         */
        cssVar: { key: theme === "dark" ? "ob-dark" : "ob-light" },
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
