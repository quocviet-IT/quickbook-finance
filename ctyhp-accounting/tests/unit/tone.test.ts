import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { TONES, ToneBadge, toneToken } from "@/lib/design/tone";
import { STATUS_KEYS, statusToken } from "@/lib/design/status";

describe("the tone vocabulary", () => {
  it("gives every tone a colour, an icon and a label", () => {
    for (const tone of TONES) {
      const token = toneToken(tone);
      expect(token.color, tone).toMatch(/^#[0-9a-f]{6}$/i);
      expect(isValidElement(token.icon), tone).toBe(true);
      expect(token.label.length, tone).toBeGreaterThan(0);
    }
  });

  it("gives every tone a distinct icon and a distinct label", () => {
    // Two tones that differ only in colour are one tone to anyone who cannot
    // tell the colours apart, and to anyone reading a printout.
    const icons = TONES.map((tone) => {
      const icon = toneToken(tone).icon;
      if (!isValidElement(icon)) throw new Error(`${tone} carries no icon element`);
      return icon.type;
    });
    expect(new Set(icons).size).toBe(TONES.length);
    expect(new Set(TONES.map((tone) => toneToken(tone).label)).size).toBe(TONES.length);
  });
});

describe("ToneBadge", () => {
  it("carries the icon and the caller's wording, not the colour alone", () => {
    const badge = ToneBadge({ tone: "danger", children: "Overdue" });
    const [icon, label] = badge.props.children as [unknown, string];
    expect(isValidElement(icon)).toBe(true);
    expect(label).toBe("Overdue");
    expect(badge.props.style.color).toBe(toneToken("danger").color);
  });
});

describe("document statuses now sit on the tone vocabulary", () => {
  it("still answers for all five, unchanged", () => {
    // status.tsx is being re-expressed, not re-specified. Its own test file
    // pins the behaviour; this pins that the two systems agree rather than
    // drifting into a second palette.
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      const tones = TONES.map((tone) => toneToken(tone).color);
      expect(tones, key).toContain(token.color);
    }
  });
});
