import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES, releasesSince } from "@/lib/domain/changelog";
import { hasUnreadRelease, RELEASES_ALL_READ } from "@/lib/domain/release-marker";
import { lastReleaseSeenServerSnapshot } from "@/lib/client/release-notes";

describe("hasUnreadRelease", () => {
  // The Guide button's dot used to be `releasesSince(seen).length > 0`, which put
  // the whole changelog in every page's JavaScript. Comparing with the current
  // version gives the same answer for every value a browser can have stored —
  // this is the proof, not an approximation of it.
  const stored: (string | null)[] = [
    null,
    "",
    "0.9-something",
    ...RELEASES.map((release) => release.version),
  ];

  it.each(stored)("agrees with the release list when %s was read last", (seen) => {
    expect(hasUnreadRelease(seen, APP_VERSION)).toBe(releasesSince(seen).length > 0);
  });

  it("shows no dot where the browser cannot say what it has read", () => {
    expect(hasUnreadRelease(RELEASES_ALL_READ, APP_VERSION)).toBe(false);
    expect(hasUnreadRelease(lastReleaseSeenServerSnapshot(), APP_VERSION)).toBe(false);
  });
});

describe("releasesSince", () => {
  it("lists nothing unread where the browser cannot say what it has read", () => {
    // A private-mode browser cannot store the marker. A dot or a list it can
    // never clear is worse than none, so it reads as everything read.
    expect(releasesSince(RELEASES_ALL_READ)).toEqual([]);
  });
});
