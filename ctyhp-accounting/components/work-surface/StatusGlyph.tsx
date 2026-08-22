/**
 * The four status marks, as inline SVG.
 *
 * These were `@ant-design/icons` components. That package creates a React
 * context at module scope and is not marked as client code, so importing one
 * into a Server Component drags the whole icon runtime into the server graph
 * and the build fails with `createContext is not a function` — which is how
 * this file came to exist.
 *
 * Two things fall out of it, both good. The panels that render these are now
 * server components and ship no JavaScript at all, and four glyphs cost four
 * paths instead of an icon library.
 *
 * Every one is `aria-hidden`: the state is always written next to the mark in
 * words, so the mark is decoration and a screen reader announcing it twice
 * would be worse than it not announcing it at all.
 */
export type GlyphName = "check" | "cross" | "warning" | "question" | "minus" | "clock" | "calendar";

const PATHS: Record<GlyphName, string> = {
  // A circle with a tick: passed.
  check: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.7 7.3-5.4 5.4a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 1 1 1.4-1.4l1.9 1.9 4.7-4.7a1 1 0 0 1 1.4 1.4z",
  // A circle with a diagonal cross: blocked.
  cross: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 12.1a1 1 0 0 1-1.4 1.4L12 13.4l-2.1 2.1a1 1 0 0 1-1.4-1.4l2.1-2.1-2.1-2.1a1 1 0 0 1 1.4-1.4l2.1 2.1 2.1-2.1a1 1 0 1 1 1.4 1.4L13.4 12z",
  // A triangle with a bar: needs attention.
  warning: "M12.9 3.6a1 1 0 0 0-1.8 0L2.3 19.5A1 1 0 0 0 3.2 21h17.6a1 1 0 0 0 .9-1.5zM12 9a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1zm0 8.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z",
  // A circle with a question mark: could not be evaluated.
  question: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.1 15.6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm1.7-6.1c-.6.4-.8.7-.8 1.2v.3a1 1 0 0 1-2 0v-.3c0-1.4.7-2.2 1.7-2.9.6-.4.8-.7.8-1.1 0-.6-.6-1-1.4-1-.7 0-1.2.3-1.5.8a1 1 0 1 1-1.7-1A3.6 3.6 0 0 1 12.1 4c1.9 0 3.4 1.2 3.4 3 0 1.2-.7 2-1.7 2.6z",
  // A circle with a bar: does not apply.
  minus: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4 11H8a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2z",
  // A clock face: how old this is.
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 9.4V7a1 1 0 1 0-2 0v5a1 1 0 0 0 .5.9l3.2 1.8a1 1 0 1 0 1-1.7z",
  // A calendar: which period.
  calendar: "M8 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 21 6.5v12A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-12A2.5 2.5 0 0 1 5.5 4H7V3a1 1 0 0 1 1-1zM5 9v9.5c0 .3.2.5.5.5h13a.5.5 0 0 0 .5-.5V9z",
};

export default function StatusGlyph({
  name,
  className,
  size = 16,
}: {
  name: GlyphName;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
