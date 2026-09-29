/**
 * A form a page opens because its link asked for it — the top-bar New menu
 * sends `?new=1`, and the page opens its own modal.
 *
 * The server cannot draw that modal: it lives in a portal, and there is no
 * document to put one in, so the page is sent with the form closed. Opened in
 * the first client render, the dialog is markup the server never sent;
 * hydration fails, and React throws the page away and draws it again (error
 * 418). Read through `useSyncExternalStore`, whose server snapshot is also what
 * the client hydrates with, the form is closed on both sides of hydration and
 * opens on the render straight after it.
 */

import { useState, useSyncExternalStore } from "react";

const noSubscription = () => () => {};

export function useInitiallyOpen(initial: boolean) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(initial);
  return [open && hydrated, setOpen] as const;
}
