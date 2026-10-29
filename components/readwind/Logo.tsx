// React components for the Readwind logo. No dependencies, no font needed (the wordmark is outlined).
// Colours come from tokens.css, so light and dark mode switch automatically.
import type { SVGProps } from "react";

const STEM = "M27.5 46Q27.5 38 35 38Q42.5 38 42.5 46V92L35 86.5L27.5 92Z";
const ARM =
  "M37.5 54C43.5 36 69.5 25 92.5 40C78.5 35 59.5 41 50 55Q45 62 42.5 72L37.5 70Z";

/** The r. mark on its own. Uses currentColor, or var(--rw-logo) by default. */
export function ReadwindMark({
  size = 32,
  ...props
}: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="26.5 31.96 67 61.04"
      width={size}
      height={(size * 61.04) / 67}
      role="img"
      aria-label="Readwind"
      style={{ color: "var(--rw-logo, currentColor)" }}
      {...props}
    >
      <g fill="currentColor">
        <path d={STEM} />
        <path d={ARM} />
        <circle cx="81.5" cy="85" r="7" />
      </g>
    </svg>
  );
}

/** App icon tile. Follows the theme: dark tile with a light r in dark mode, and the reverse in light mode. */
export function ReadwindIcon({
  size = 64,
  ...props
}: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="Readwind"
      {...props}
    >
      <rect
        width="120"
        height="120"
        rx="27"
        fill="var(--rw-icon-tile, #111111)"
      />
      <rect
        x=".75"
        y=".75"
        width="118.5"
        height="118.5"
        rx="26.25"
        fill="none"
        stroke="var(--rw-border, transparent)"
        strokeWidth="1.5"
      />
      <g fill="var(--rw-icon-glyph, #FAFAF7)">
        <path d={STEM} />
        <path d={ARM} />
        <circle cx="81.5" cy="85" r="7" />
      </g>
    </svg>
  );
}

/** Mark and wordmark together. The app is light-only, so only the black lockup ships. */
export function ReadwindLockup({
  height = 40,
  tagline = false,
}: {
  height?: number;
  tagline?: boolean;
}) {
  const src = tagline
    ? "/brand/readwind-lockup-tagline-black.svg"
    : "/brand/readwind-lockup-black.svg";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Readwind" height={height} />;
}
