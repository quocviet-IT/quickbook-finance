/**
 * Which release this browser has already read about.
 *
 * Kept in `localStorage` for the same reason the help cluster's collapsed state
 * is: it is a reading preference, not accounting data, and a table for it would
 * be a migration across every company schema to remember one string.
 *
 * Exposed as an external store so a component can read it with
 * `useSyncExternalStore`. That hook is the only honest way to get a
 * browser-only value into a rendered tree here — see the server snapshot below.
 */

import { APP_VERSION } from "@/lib/domain/changelog";

const SEEN_KEY = "onebook.release-notes.seen";

const listeners = new Set<() => void>();

export function lastReleaseSeen(): string | null {
  if (typeof window === "undefined") return APP_VERSION;
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    // A private-mode browser throws. Treat it as read: a dot that can never be
    // cleared is worse than no dot at all.
    return APP_VERSION;
  }
}

/**
 * What the server renders: everything already read, so no badge appears in the
 * server HTML.
 *
 * The server cannot know what this browser has read. If it guessed "unread",
 * every page load would flash a dot and then drop it, which is exactly how
 * people learn to ignore a badge.
 */
export function lastReleaseSeenServerSnapshot(): string | null {
  return APP_VERSION;
}

export function markReleasesSeen(version: string = APP_VERSION): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SEEN_KEY, version);
    } catch {
      /* Nothing to persist to. The notes were still read, which was the point. */
    }
  }
  for (const listener of listeners) listener();
}

/** Also follows the other tabs: `storage` fires there, not in the writing tab. */
export function subscribeReleaseNotes(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SEEN_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
