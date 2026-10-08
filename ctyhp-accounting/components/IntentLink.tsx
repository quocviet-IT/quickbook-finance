"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that prefetches when someone shows they may follow it — the pointer
 * over it, keyboard focus on it, a finger on it — rather than when it scrolls
 * into view.
 *
 * The shell draws about twenty links on every page. A plain <Link> prefetches
 * each one it can see, and for a dynamic route that prefetch runs the proxy and
 * the signed-in layout on the server, sign-in check and database calls
 * included, for a page nobody asked for: about seventeen such requests after
 * every full page load, measured on production. Prefetching on intent keeps
 * the head start for the link someone is about to click and drops the rest.
 *
 * Next's own pattern (Linking and Navigating, "Disabling prefetching"), with
 * focus and touch added so keyboard and phone users get the head start too.
 * Once intent is shown the link prefetches as a plain <Link> would.
 */
export default function IntentLink({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? (prefetch ?? null) : false}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
    />
  );
}
