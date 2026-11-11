/**
 * The Abacus mark (3.0.20): a frame, a beam, three rods and their beads, one
 * bead in amber.
 *
 * A self-contained light tile, the same in both themes, the way a logo is: it
 * carries its own colours rather than the page's, so it reads the same on the
 * deep teal header, on a white card and on a dark one. That is why it is the
 * one file in components/ with colours written out (see the allowlist in
 * tests/unit/no-hardcoded-color.test.ts).
 */

const TILE = "#f0fdfa";
const TILE_EDGE = "#9fcfc8";
const FRAME = "#0f5c56";
const BEAD = "#0f766e";
const AMBER = "#d97706";

/** Bead centres on the rods at x 11, 16 and 21; the amber one is the last. */
const BEADS: readonly [number, number][] = [
  [11, 9.5],
  [21, 9.5],
  [11, 15.8],
  [11, 19.4],
  [16, 22.6],
  [21, 15.8],
  [21, 22.6],
];

export default function AbacusMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", display: "block" }}
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill={TILE} stroke={TILE_EDGE} />
      <g fill="none" stroke={FRAME} strokeLinecap="round">
        <rect x="6.5" y="6.5" width="19" height="19" rx="3" strokeWidth="1.6" />
        <path d="M6.5 12.5h19" strokeWidth="1.6" />
        <path d="M11 6.5v19M16 6.5v19M21 6.5v19" strokeWidth="1" />
      </g>
      {BEADS.map(([cx, cy]) => (
        <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="2.6" ry="1.6" fill={BEAD} />
      ))}
      <ellipse cx="16" cy="18.8" rx="2.6" ry="1.6" fill={AMBER} />
    </svg>
  );
}
