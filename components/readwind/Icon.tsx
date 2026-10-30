import type { CSSProperties } from "react";
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    back: <path d="M15 5l-7 7 7 7" />,
    next: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
    contents: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    notebook: (
      <>
        <path d="M6 3h11a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z" />
        <path d="M9 8h7M9 12h5" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v15H5.5A1.5 1.5 0 0 0 4 20.5z" />
        <path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H19" />
      </>
    ),
    full: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    spread: (
      <>
        <rect x="2.5" y="4.5" width="9" height="15" rx="1" />
        <rect x="12.5" y="4.5" width="9" height="15" rx="1" />
      </>
    ),
    single: <rect x="6.5" y="3.5" width="11" height="17" rx="1" />,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    check: <path d="m5 12 4 4L19 6" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    cloud: (
      <>
        <path d="M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 1 4.5 4.5 0 0 1 0 9" />
        <path d="m9 16 3-3 3 3M12 13v8" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" />,
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m21 15-4.5-4.5L7 20" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H5v20h14V7zM14 2v5h5" />
        <path d="M8 12h8M8 16h6" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
    system: (
      <>
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}
