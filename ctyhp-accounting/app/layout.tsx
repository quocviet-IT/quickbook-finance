import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Providers from "./providers";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { noFlashScript } from "@/lib/domain/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "One Book",
  description: "One Book accounting operations webapp",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        <script dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
      </head>
      <body>
        <AntdRegistry>
          {/* Outside Providers, which reads the resolved theme from it to
              choose Ant Design's algorithm. */}
          <ThemeProvider>
            <Providers>{children}</Providers>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
