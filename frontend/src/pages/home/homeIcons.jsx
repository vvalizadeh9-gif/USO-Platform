// UEP Home's own icons: bold, two-path line drawings on a 24px grid, simple
// enough to read at 20px. Each has a grey base stroke and one accent (a
// stroke or a fill) in its own colour; inside a coloured tile the same
// drawing renders all white (`tone="white"`). lucide-react stays for the
// small single-colour UI glyphs (search, arrows, the clock in a tag).
//
// No icon here is green: green means approved in UEP.

const BASE = '#616161'

const BLUE = '#0F6CBD'
const RED = '#C50F1F'
const ORANGE = '#DA3B01'
const INDIGO = '#4F52B2'
const PLUM = '#8E2483'

// base: the grey drawing; accent: the coloured part. `fill: true` fills the
// accent instead of stroking it.
const ICONS = {
  inbox: {
    base: 'M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5L17.5 5h-11z',
    accent: 'M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
    color: BLUE,
  },
  clock: {
    base: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z',
    accent: 'M12 7.5V12l3 2',
    color: RED,
  },
  hourglass: {
    base: 'M6.5 3.5h11M6.5 20.5h11M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5',
    accent: 'M9.5 18.5c0-2 5-2 5 0z',
    color: ORANGE,
    fill: true,
  },
  calendarCheck: {
    base: 'M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
    accent: 'M9 14.5l2 2 4-4',
    color: INDIGO,
  },
  car: {
    base: 'M5 16.5V12l2-5h10l2 5v4.5M3.5 16.5h17M6.5 16.5V19M17.5 16.5V19',
    accent: 'M8 13.5h.01M16 13.5h.01M7 12h10',
    color: BLUE,
  },
  documentCheck: {
    base: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4',
    accent: 'M9 14l2 2 4-4',
    color: INDIGO,
  },
  calendarBars: {
    base: 'M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
    accent: 'M8 13.5h8M8 16.5h5',
    color: PLUM,
  },
  pulse: {
    base: 'M3.5 12h4',
    accent: 'M7.5 12l2-5 4 10 2-5h5',
    color: BLUE,
  },
  checklist: {
    base: 'M11 6.5h9M11 12h9M11 17.5h9',
    accent: 'M4 6.5l1.5 1.5L8 5.5M4 12l1.5 1.5L8 11M4 17.5l1.5 1.5L8 16.5',
    color: BLUE,
  },
  briefcase: {
    base: 'M3.5 7.5h17v12h-17zM9 7.5V5h6v2.5',
    accent: 'M3.5 12.5h17',
    color: INDIGO,
  },
  bars: {
    base: 'M3.5 20.5h17',
    accent: 'M6.5 17V11M12 17V6M17.5 17v-4',
    color: INDIGO,
  },
  pie: {
    base: 'M11 4.5a8 8 0 1 0 8.5 8.5H11z',
    accent: 'M14 2.5v7.5h7.5A7.5 7.5 0 0 0 14 2.5z',
    color: INDIGO,
    fill: true,
  },
  people: {
    base: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5',
    accent: 'M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.5 2.4 3.5 5.2',
    color: INDIGO,
  },
  brokenLink: {
    base: 'M10 6.5l1-1a4.2 4.2 0 0 1 6 6l-1 1M14 17.5l-1 1a4.2 4.2 0 0 1-6-6l1-1',
    accent: 'M4 4l3 3M20 20l-3-3M9.5 3v2.5M14.5 21v-2.5',
    color: RED,
  },
  calendarSquare: {
    base: 'M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
    accent: 'M8 13h4v4H8z',
    color: PLUM,
    fill: true,
  },
  grid: {
    base: 'M4 4h6.5v6.5H4zM13.5 13.5H20V20h-6.5zM4 13.5h6.5V20H4z',
    accent: 'M13.5 4H20v6.5h-6.5z',
    color: PLUM,
    fill: true,
  },
  wrench: {
    base: 'M14.5 4.5a4.5 4.5 0 0 0-4.2 6.1L4 16.9 7.1 20l6.3-6.3a4.5 4.5 0 0 0 6.1-4.2',
    accent: 'M19.5 9.5l-2.5.5-2-2 .5-2.5',
    color: RED,
  },
}

export const HOME_ICON_NAMES = Object.keys(ICONS)

/**
 * One Home icon. Decorative: whatever it sits beside names it, so it is
 * hidden from assistive technology.
 */
export default function HomeIcon({ name, size = 24, tone = 'color', className }) {
  const icon = ICONS[name]
  if (!icon) return null
  const white = tone === 'white'
  const base = white ? '#FFFFFF' : BASE
  const accent = white ? '#FFFFFF' : icon.color
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      <path d={icon.base} stroke={base} />
      <path
        d={icon.accent}
        stroke={accent}
        fill={icon.fill ? accent : 'none'}
        strokeWidth={icon.fill ? 1.5 : 2.25}
      />
    </svg>
  )
}
