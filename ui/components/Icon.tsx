import type { ReactNode } from "react";
import { cx } from "../util";

/** One stroke set for every icon, drawn on a 24-unit grid; each is decorative, its button names it. */
const PATHS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  external: <path d="M14 4h6v6M10 14 20 4M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  terminal: <path d="m4 17 6-6-6-6M12 19h8" />,
  window: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, filled, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("shrink-0", className)}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The one look of a small action beside what it acts on: an icon and a short label, in the interface's own face whatever surrounds it. */
export const ACTION = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-sans text-[11px] font-medium text-stone-600 not-italic hover:bg-stone-100 hover:text-stone-900";

export function Action({ icon, label, onClick, title, href }: { icon: IconName; label: string; onClick?: () => void; title?: string; href?: string }) {
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title} className={ACTION}>
        <Icon name={icon} size={12} />
        {label}
      </a>
    );
  return (
    <button type="button" onClick={onClick} title={title} className={ACTION}>
      <Icon name={icon} size={12} />
      {label}
    </button>
  );
}

/** A row of actions, kept together and in one face. */
export function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("flex flex-wrap items-center gap-0.5 font-sans", className)}>{children}</span>;
}
