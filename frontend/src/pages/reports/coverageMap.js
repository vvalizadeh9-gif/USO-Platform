// Coverage map: the arithmetic and geometry the map does in the browser.
//
// Everything is derived from one `/gaps/map` response. The server sends hex
// cells as axial (q, r) coordinates, each tagged with the province and CRA
// region that own it; this file turns them into SVG paths, and turns the
// figures into colours. Kept out of the component so each rule can be tested
// on its own.

/** How many colour bands the legend has. Both maps share them. */
export const BAND_COUNT = 5

/**
 * Worst to best. Red where approval is lowest, teal where it is highest: the
 * KPI page's "worse" and "better" shades, so a colour means the same thing on
 * this page as on that one. The middle is pale amber rather than grey, so it
 * cannot be mistaken for the hatch or for a blank area.
 */
export const BAND_COLOURS = ['#E4877F', '#F4B9B3', '#F3DFA6', '#9FDDD2', '#5CC4B3']

/**
 * The approval rate: the share of what reached a stretch that got past it.
 *
 * The server sends the stop rate; approval is its complement, worked from the
 * two counts rather than from the rounded rate so it is exact.
 */
export function approvalRate(row) {
  if (!row || !row.reached) return null
  return ((row.reached - row.stopped) * 100) / row.reached
}

/** A row the map can colour: a real owner, enough villages, something reached. */
export function comparable(row) {
  return row.attribution === 'owned' && !row.low_sample && approvalRate(row) != null
}

/**
 * The shared colour bands, from the rows both maps will colour.
 *
 * Low-sample rows are left out before the range is taken. Three villages all
 * approved is 100%, and letting it set the top of the scale would squeeze
 * every province that has a real sample into the bottom bands.
 *
 * The range is rounded out to whole multiples of five so the legend reads
 * "55–65%" rather than "57.3–64.9%". Returns null when nothing is comparable.
 */
export function bands(rows) {
  const rates = rows.filter(comparable).map(approvalRate)
  if (rates.length === 0) return null
  const lo = Math.floor(Math.min(...rates) / 5) * 5
  let hi = Math.ceil(Math.max(...rates) / 5) * 5
  if (hi <= lo) hi = lo + 5
  const step = (hi - lo) / BAND_COUNT
  return {
    lo,
    hi,
    step,
    edges: Array.from({ length: BAND_COUNT + 1 }, (_, i) => lo + i * step),
  }
}

/** Which band a rate falls in, 0 (worst) to BAND_COUNT - 1 (best). */
export function bandOf(rate, scale) {
  if (rate == null || !scale) return null
  const index = Math.floor((rate - scale.lo) / scale.step)
  return Math.max(0, Math.min(BAND_COUNT - 1, index))
}

/** The fill for one row: a band colour, or null for the hatch. */
export function fillOf(row, scale) {
  if (!row || !comparable(row)) return null
  return BAND_COLOURS[bandOf(approvalRate(row), scale)]
}

/* ---------------------------------------------------------------------------
   Hex geometry. Pointy-top, axial coordinates -- the inverse of `hex_of` in
   `services/gaps.py`, which is what put each site in its hex. The two must
   stay pointy-top and axial together.
   --------------------------------------------------------------------------- */

/** Hex circumradius in SVG units. The viewBox scales it to fit. */
export const HEX = 10
const SQRT3 = Math.sqrt(3)

/**
 * The neighbour across each edge. Edge i runs from corner i to corner i + 1
 * and faces 60·i degrees (screen coordinates, y down).
 */
const NEIGHBOURS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]

export function centre(q, r) {
  return [HEX * SQRT3 * (q + r / 2), HEX * 1.5 * r]
}

export function corners(q, r) {
  const [cx, cy] = centre(q, r)
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((60 * i - 30) * Math.PI) / 180
    return [cx + HEX * Math.cos(angle), cy + HEX * Math.sin(angle)]
  })
}

const pt = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`

/** One path covering every hex in a shape: one subpath per hex. */
export function fillPath(cells) {
  return cells
    .map((cell) => `M${corners(cell.q, cell.r).map(pt).join('L')}Z`)
    .join('')
}

/**
 * The outlines between shapes: every hex edge whose neighbour belongs to a
 * different shape, or to none.
 *
 * This is what makes nine regions read as nine shapes rather than a few
 * hundred hexes. Edges inside a shape are never drawn, so the region's
 * provinces dissolve into it.
 */
export function borderPath(cells, keyOf) {
  const owner = new Map(cells.map((cell) => [`${cell.q},${cell.r}`, keyOf(cell)]))
  const parts = []
  for (const cell of cells) {
    const mine = keyOf(cell)
    const points = corners(cell.q, cell.r)
    NEIGHBOURS.forEach(([dq, dr], i) => {
      if (owner.get(`${cell.q + dq},${cell.r + dr}`) === mine) return
      parts.push(`M${pt(points[i])}L${pt(points[(i + 1) % 6])}`)
    })
  }
  return parts.join('')
}

/** A viewBox that fits every cell with a margin, or null for no cells. */
export function viewBox(cells) {
  if (cells.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const cell of cells) {
    const [x, y] = centre(cell.q, cell.r)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const pad = HEX * 2
  return [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad]
    .map((value) => value.toFixed(1))
    .join(' ')
}

/** Cells grouped by a key, in first-seen order; cells with no key are dropped. */
export function groupCells(cells, keyOf) {
  const groups = new Map()
  for (const cell of cells) {
    const key = keyOf(cell)
    if (key == null) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(cell)
  }
  return groups
}
