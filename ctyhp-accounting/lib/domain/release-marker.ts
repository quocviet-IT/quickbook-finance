/**
 * What the Guide button needs to know about the release notes, without the
 * release notes.
 *
 * The button is on every page, and the changelog it used to import is the
 * largest module the shell carried. Its unread dot only asks whether the newest
 * release is the one this browser last read: the releases are stored newest
 * first with unique versions (a test in changelog.test.ts holds them to that),
 * so "anything newer than what was read" and "what was read is not the newest"
 * are the same question. release-marker.test.ts proves it for every value a
 * browser can have stored.
 */

/**
 * Stands for "nothing unread" where this browser cannot say what it has read:
 * on the server, and in a browser whose storage throws. Never stored, and never
 * a version.
 */
export const RELEASES_ALL_READ = "all-read";

export function hasUnreadRelease(seen: string | null, appVersion: string): boolean {
  return seen !== RELEASES_ALL_READ && seen !== appVersion;
}
