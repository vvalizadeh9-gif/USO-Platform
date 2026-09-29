/**
 * The progress chart's geometry: pure functions of screen points, kept apart
 * from the component so each is tested on its own.
 */

/** The chart's two views. The choice is the page's, shared across tabs. */
export const MODES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'cumulative', label: 'Cumulative' },
]

/** End labels closer than this are pushed apart. */
export const MIN_LABEL_GAP = 15

/** Space labels at least MIN_LABEL_GAP apart, top to bottom, inside the plot. */
export function nudge(items, min, max) {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i += 1) {
    sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + MIN_LABEL_GAP)
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - max : 0
  if (overflow > 0) sorted.forEach((item) => (item.y -= overflow))
  if (sorted.length && sorted[0].y < min) {
    const shift = min - sorted[0].y
    sorted.forEach((item) => (item.y += shift))
  }
  return sorted
}

export const lastOf = (pts) => [...pts].reverse().find(Boolean) ?? null

/** Consecutive defined points: a plan that starts mid-window is drawn from
 * where it starts, never from an invented zero. */
export function runs(pts) {
  const out = []
  let run = []
  for (const p of pts) {
    if (p) run.push(p)
    else if (run.length) {
      out.push(run)
      run = []
    }
  }
  if (run.length) out.push(run)
  return out
}

export function linePath(run) {
  return run.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

export function areaPath(run, base) {
  const first = run[0]
  const last = run[run.length - 1]
  return `${monotonePath(run)} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`
}

/**
 * A monotone cubic through the points (Fritsch-Carlson): smooth, and never
 * overshooting -- a running total that bulged above its own next value would
 * draw a month that never happened.
 */
export function monotonePath(run) {
  const n = run.length
  if (n === 0) return ''
  if (n === 1) return `M${run[0].x.toFixed(1)},${run[0].y.toFixed(1)}`
  const dx = []
  const m = []
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(run[i + 1].x - run[i].x)
    m.push((run[i + 1].y - run[i].y) / dx[i])
  }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i += 1) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[i] = tau * a * m[i]
      t[i + 1] = tau * b * m[i]
    }
  }
  let d = `M${run[0].x.toFixed(1)},${run[0].y.toFixed(1)}`
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3
    const p0 = run[i]
    const p1 = run[i + 1]
    d += ` C${(p0.x + h).toFixed(1)},${(p0.y + t[i] * h).toFixed(1)} ${(p1.x - h).toFixed(1)},${(p1.y - t[i + 1] * h).toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
  }
  return d
}
