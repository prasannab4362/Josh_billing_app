// The app's own icon set: simple line drawings on a 24 × 24 grid, drawn with the current text colour.
// Kept in one file so every screen uses the same weight and style, with no icon library to install.
import type { ReactNode } from 'react'

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  box: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.2l9 4.6" />,
  receipt: <path d="M5 3h14v18l-2.5-1.8L14 21l-2-1.8L10 21l-2.5-1.8L5 21zM9 8h6M9 12h6M9 16h3" />,
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h10.1a1 1 0 0 0 1-.8L21 7H6" />
    </>
  ),
  wallet: (
    <>
      <path d="M17 5H6a3 3 0 0 0 0 6M3 8v10a2 2 0 0 0 2 2h15V9a1 1 0 0 0-1-1H6a3 3 0 0 1-3-3" />
      <circle cx="16" cy="14.5" r="1.2" />
    </>
  ),
  bank: <path d="M3 9.5 12 4l9 5.5M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 20.5h18" />,
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  chart: <path d="M4 20V11M10 20V5M16 20v-6M3 20.5h18" />,
  sparkles: (
    <path d="M11 3l1.9 5 5.1 1.9-5.1 1.9L11 17l-1.9-5.2L4 9.9l5.1-1.9zM18.5 14.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.9z" />
  ),
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowIn: <path d="M17 7 7 17M16 17H7V8" />,
  arrowOut: <path d="M7 17 17 7M8 7h9v9" />,
  swap: <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />,
  printer: <path d="M6 9V3h12v6M6 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  file: <path d="M6 2.5h8l5 5V21a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 21zM14 2.5v5h5M9 13h6M9 17h6" />,
  sheet: <path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 9h16M4 15h16M10 3v18" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  chat: <path d="M4.5 19.5 6 15.6A8 8 0 1 1 8.4 18zM9 11h.01M12 11h.01M15 11h.01" />,
  tag: (
    <>
      <path d="M3 12.2V4a1 1 0 0 1 1-1h8.2L21 11.8 12.8 20z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  barcode: <path d="M3 5v14M6 5v14M9.5 5v14M12 5v14M15.5 5v14M18 5v14M21 5v14" />,
  alert: <path d="M12 3.5 2.5 20h19zM12 10v4M12 17h.01" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  trendUp: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  logout: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" />,
  building: <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  copy: <path d="M9 9h11v11H9zM15 9V4H4v11h5" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5" />,
  percent: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.2" />
      <circle cx="17" cy="17" r="2.2" />
    </>
  ),
  ruler: <path d="M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />,
  hash: <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  layers: <path d="M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5" />,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  history: <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4.5h4.5M12 7v5l3.5 2" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  store: <path d="M4 10v10h16V10M3 4h18l-1 6H4zM9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7L11.8 6.5M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.4-1.4" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  )
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg
      className={className ? `ico ${className}` : 'ico'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

/** A rounded, tinted square holding an icon: used on page titles, stat cards and empty states. */
export function IconTile({ name, tone = 'accent', size = 'md' }: { name: IconName; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'lg' ? 26 : size === 'sm' ? 16 : 20
  return (
    <span className={`icon-tile ${tone} ${size}`}>
      <Icon name={name} size={px} />
    </span>
  )
}

export type Tone = 'accent' | 'green' | 'red' | 'amber' | 'violet' | 'teal' | 'slate' | 'pink'

/** Page title with its icon and an optional line under it. */
export function PageTitle({ icon, title, sub, tone = 'accent' }: { icon: IconName; title: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="page-title">
      <IconTile name={icon} tone={tone} />
      <div>
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
    </div>
  )
}

/** A friendly empty state: icon, a short line and an optional action. */
export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <IconTile name={icon} tone="slate" size="lg" />
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}
