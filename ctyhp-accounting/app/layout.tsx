import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Providers from "./providers";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { NONCE_HEADER } from "@/lib/domain/content-security-policy";
import {
  noFlashScript,
  parseSystemPrefersDark,
  parseThemeMode,
  SYSTEM_THEME_COOKIE,
  THEME_STORAGE_KEY,
} from "@/lib/domain/theme";
import "./globals.css";
// Ant Design's component styles, prebuilt (zero-runtime mode, see providers.tsx):
// one cached file instead of a stylesheet generated into every page. After
// globals.css, where the generated stylesheet used to land: it was emitted
// into <head> behind the app's own CSS, so on a tie of specificity Ant Design
// won, and every screen was approved looking that way. Importing it first
// flips those ties to the app on every page — the menu grows to 44px rows,
// badges and buttons change colour and shadow — a redesign nobody asked for.
// A page's own CSS module still loads after this file and wins its ties, as
// its author wrote it to.
import "antd/dist/antd.css";

export const metadata: Metadata = {
  title: "One Book",
  description: "One Book accounting operations webapp",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The theme, from the cookie the toggle writes. This is what lets the
  // FIRST server-rendered byte carry the right Ant Design palette — without
  // it a dark reader watched every reload and company switch arrive light
  // and turn dark once React caught up, seconds later on a heavy page. A
  // reader with no cookie yet gets "system", and the inline script below
  // still sets the attribute correctly before anything paints.
  //
  // "System" is resolved from the second cookie, which the inline script
  // writes with what the machine prefers. Without it every system reader on
  // a dark machine was rendered light and turned dark after hydration, and a
  // Suspense boundary that hydrated after the turn kept its light classes.
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  const initialMode = parseThemeMode(jar.get(THEME_STORAGE_KEY)?.value);
  const initialSystemPrefersDark = parseSystemPrefersDark(jar.get(SYSTEM_THEME_COOKIE)?.value);
  // The Content-Security-Policy runs only scripts carrying this response's
  // nonce (proxy.ts); Next stamps its own, this one is ours to stamp.
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Sets the theme before anything is painted.

          It must be inline and ahead of React: the server cannot know what
          this browser stores or what its operating system prefers, so
          without this the first paint is light and the reader watches it
          turn dark a moment later, on every navigation that reloads. That
          flash is the one thing a theme switch is judged on.

          `suppressHydrationWarning` above is for the attribute this writes.
          React renders <html> without it and finds it already set; the
          warning is correct and the mismatch is the entire point.
        */}
        {/* The browser hides a nonce from the DOM once it has checked it, so
            hydration finds it empty; that difference is expected. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
      </head>
      <body>
        <AntdRegistry>
          {/* Outside Providers, which reads the resolved theme from it to
              choose Ant Design's algorithm. */}
          <ThemeProvider initialMode={initialMode} initialSystemPrefersDark={initialSystemPrefersDark}>
            <Providers>{children}</Providers>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
