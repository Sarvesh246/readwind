import { useId } from "react";

/** A hand-drawn flame: layered teardrop with a warm gradient, not an emoji. `lit={false}` renders the banked ember. */
export function Flame({
  size = 24,
  lit = true,
  className = "",
}: {
  size?: number;
  lit?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`flame ${lit ? "lit" : "dim"} ${className}`}
      width={size}
      height={Math.round(size * 1.25)}
      viewBox="0 0 32 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}o`} x1="16" y1="1" x2="16" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFB84D" />
          <stop offset="0.5" stopColor="#F0701F" />
          <stop offset="1" stopColor="#C93A1E" />
        </linearGradient>
        <linearGradient id={`${id}i`} x1="16" y1="17" x2="16" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFE9A0" />
          <stop offset="1" stopColor="#FF9B3D" />
        </linearGradient>
      </defs>
      <g className="flame-body">
        <path
          className="flame-outer"
          fill={lit ? `url(#${id}o)` : undefined}
          d="M16.6 1.2c.9 6.6 9.4 9.9 9.4 22.2 0 8.5-4.4 15.6-10 15.6S6 31.900 6 23.800c0-5.300 2.800-8.800 5.600-11.400.2 3.400 1.700 5.200 3.400 5.900-1.300-6.300-.8-12.100 1.600-17.100z"
        />
        <path
          className="flame-inner"
          fill={lit ? `url(#${id}i)` : undefined}
          d="M16 17.600c1.700 3.500 5.200 5.800 5.200 10.800 0 4.100-2.300 7.100-5.200 7.100s-5.200-3-5.200-7.100c0-3.500 3.400-5.400 5.200-10.800z"
        />
        <path
          className="flame-core"
          d="M16 26.500c.9 1.900 2.600 3.100 2.600 5.500 0 1.800-1.100 3.100-2.600 3.100s-2.600-1.300-2.600-3.100c0-1.900 1.700-3 2.600-5.500z"
        />
      </g>
    </svg>
  );
}
