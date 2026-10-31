import { useId } from "react";

/**
 * A hand-drawn flame: a back tongue for depth, a leaning main body, a two-tone
 * inner flame, a hot core and a soft rim light. Not an emoji. `lit={false}`
 * renders the banked ember. Sparks only appear on large marks (>= 40px).
 */
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
  const sparks = lit && size >= 40;
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
        <linearGradient id={`${id}b`} x1="26" y1="6" x2="24" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E8501C" />
          <stop offset="1" stopColor="#A82A1A" />
        </linearGradient>
        <linearGradient id={`${id}o`} x1="16" y1="1" x2="16" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC24D" />
          <stop offset="0.45" stopColor="#F47A1F" />
          <stop offset="1" stopColor="#D2401C" />
        </linearGradient>
        <radialGradient id={`${id}i`} cx="16" cy="35" r="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF1B8" />
          <stop offset="0.55" stopColor="#FFC85A" />
          <stop offset="1" stopColor="#FF9B3D" />
        </radialGradient>
      </defs>
      <g className="flame-body">
        <path
          className="flame-back"
          fill={lit ? `url(#${id}b)` : undefined}
          d="M25.8 7.4c.5 4.700 4.600 7.100 4.600 14 0 5.800-3.100 9.700-7.400 10.800l-1-9.200c2.700-3.800 3.100-9 3.800-15.600z"
        />
        <path
          className="flame-outer"
          fill={lit ? `url(#${id}o)` : undefined}
          d="M17.4 1c1 6.900 9.400 10.500 9.400 22.600 0 8.800-4.600 15.200-10.800 15.200S5.200 32.700 5.200 25c0-5.100 2.300-8.800 5.200-11.600.4 3 1.700 5 3.500 5.800-1.400-6.900-.2-13.800 3.500-18.200z"
        />
        <path
          className="flame-inner"
          fill={lit ? `url(#${id}i)` : undefined}
          d="M16.4 14.600c1.100 4.800 6 7 6 14.200 0 4.600-2.700 8.100-6.400 8.100s-6.200-3.300-6.200-7.700c0-3.400 2.100-5.400 3.600-8.100.7 1.700 1.500 2.500 2.300 2.800-.8-3-.6-6.300.7-9.300z"
        />
        <path
          className="flame-core"
          d="M16 27c1.200 2.600 3.100 3.700 3.100 6.400 0 1.900-1.300 3.200-3.100 3.200s-3.100-1.300-3.100-3.200c0-2.600 1.900-3.800 3.100-6.400z"
        />
        <path
          className="flame-shine"
          d="M8.600 25.200c-.1-3 1-5.500 2.500-7.400"
          fill="none"
          strokeWidth="1.300"
          strokeLinecap="round"
        />
      </g>
      {sparks && (
        <g className="flame-sparks">
          <circle className="flame-spark s1" cx="25.500" cy="3.200" r="1" />
          <circle className="flame-spark s2" cx="8" cy="7" r="0.8" />
          <circle className="flame-spark s3" cx="29" cy="13" r="0.7" />
        </g>
      )}
    </svg>
  );
}
