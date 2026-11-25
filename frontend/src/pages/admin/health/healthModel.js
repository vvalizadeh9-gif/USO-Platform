/**
 * Admin › System health: formatting and the colour rules, apart from the
 * markup so they are tested on their own (UEP-25). The thresholds are the
 * server's (services/system_health.py): gauges amber at 75 %, red at 90 %;
 * backup red after 7 days; Mojri red after 30; migrations red on mismatch.
 */

/** "812 MB", "3.4 GB". */
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '—'
  const n = Number(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const digits = i === 0 || Math.abs(v) >= 100 ? 0 : 1
  return `${v.toFixed(digits)} ${units[i]}`
}

/** "+120 MB" / "−4 MB" / "No change". */
export function formatGrowth(bytes) {
  if (bytes == null) return '—'
  if (bytes === 0) return 'No change'
  return `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`
}

/** "1.5 cores", "250m" stays readable: cores with up to two decimals. */
export function formatCores(cores) {
  if (cores == null) return '—'
  return `${Number(cores.toFixed(2))} core${cores === 1 ? '' : 's'}`
}

/** The server sends ok | amber | red | unknown; this is the label beside it. */
export const STATE_LABEL = { ok: 'Normal', amber: 'Watch', red: 'Problem', unknown: 'Not known' }

/** A gauge's state from its percent, the same rule as the server's. */
export function gaugeState(percent) {
  if (percent == null) return 'unknown'
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'amber'
  return 'ok'
}

/** Whole days between an ISO date and today. */
export function daysSince(isoDate, today = new Date()) {
  if (!isoDate) return null
  const then = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((now - then.getTime()) / 86400000)
}

/** "today", "yesterday", "9 days ago". */
export function agoText(days) {
  if (days == null) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Points for a 0..1 normalised area chart: [{x, y, value, day}]. */
export function areaPoints(series, key, width, height, pad = 4) {
  const values = series.map((d) => d[key])
  if (values.length === 0) return []
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0
  return series.map((d, i) => ({
    x: pad + i * step,
    y: pad + (height - pad * 2) * (1 - (d[key] - min) / span),
    value: d[key],
    day: d.day,
  }))
}
