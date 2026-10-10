"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { HookAPI } from "antd/es/modal/useModal";

/**
 * Do not lose typing by leaving the page.
 *
 * While `dirty` is true:
 * - closing the tab, reloading, or typing another address asks the browser's own
 *   question (`beforeunload`);
 * - clicking one of the app's own links (the sidebar, a breadcrumb, any anchor
 *   that stays on this site) is held back and put to the reader in a dialog
 *   first, because the browser asks nothing when the app navigates client-side.
 *
 * The browser's Back button is left alone: it cannot be held back without
 * rewriting history, and the draft is one Save away from safe.
 */
export function useUnsavedGuard(dirty: boolean, modal: HookAPI, what = "this count") {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome still wants a returnValue to show its dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // The same page (a hash, or the same path and query) is not leaving it.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = `${url.pathname}${url.search}${url.hash}`;
      modal.confirm({
        title: "Leave without saving?",
        content: `You have changes to ${what} that are not saved. Leaving now throws them away.`,
        okText: "Leave",
        okButtonProps: { danger: true },
        cancelText: "Stay and keep editing",
        onOk: () => {
          dirtyRef.current = false;
          router.push(destination);
        },
      });
    };
    // Capture phase: this runs before the link's own handler starts the navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [modal, router, what]);
}
