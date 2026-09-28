// Lifecycle Gaps: the arithmetic the page does in the browser.
//
// Everything here is derived from one `/gaps/overview` response and nothing
// else. Kept out of the component so each rule can be tested on its own.
//
// The live checksum is the one rule that matters most: the details panel adds
// up the rows it is about to draw and says out loud whether they make the
// gap's total. A design preview of this page once showed 2,570 at the top
// beside an owner list adding to 445, and it reached a person because nothing
// on the screen ever added the rows up.

/**
 * The three blocks of the first screen, in order. ICT is always the left
 * column and CRA the right one, in every block.
 */
export const BLOCKS = [
  { key: 'pending', title: 'Pending approval', gaps: ['pending_ict', 'pending_cra'] },
  {
    key: 'remained',
    title: 'One approved, other remained',
    gaps: ['ict_remained', 'cra_remained'],
  },
  {
    key: 'mojri',
    title: 'Mojri tracker vs MTN',
    gaps: ['ict_missing_in_mojri', 'cra_missing_in_mojri'],
  },
]

/**
 * One entry per gap the API returns.
 *
 * `label` is the word under the column, beside the authority chip. `baseName`
 * names what the base counts, for the captions ("of 2,555 CRA-approved").
 * `showBase` draws the faint base column behind the gap (blocks 2 and 3).
 */
export const GAPS = {
  pending_ict: {
    authority: 'ICT', block: 'pending', label: 'pending',
    title: 'Pending ICT approval', baseName: 'drive-tested', showBase: false,
  },
  pending_cra: {
    authority: 'CRA', block: 'pending', label: 'pending',
    title: 'Pending CRA approval', baseName: 'drive-tested', showBase: false,
  },
  ict_remained: {
    authority: 'ICT', block: 'remained', label: 'remained',
    title: 'ICT remained (CRA approved)', baseName: 'CRA-approved', showBase: true,
  },
  cra_remained: {
    authority: 'CRA', block: 'remained', label: 'remained',
    title: 'CRA remained (ICT approved)', baseName: 'ICT-approved', showBase: true,
  },
  ict_missing_in_mojri: {
    authority: 'ICT', block: 'mojri', label: 'missing in Mojri',
    title: 'ICT approved, missing in Mojri', baseName: 'ICT-approved', showBase: true,
    mojri: true,
  },
  cra_missing_in_mojri: {
    authority: 'CRA', block: 'mojri', label: 'missing in Mojri',
    title: 'CRA approved, missing in Mojri', baseName: 'CRA-approved', showBase: true,
    mojri: true,
  },
}

/** The panel's lens tabs, in the order the design gives them. */
export const LENSES = [
  { key: 'province', label: 'Province' },
  { key: 'rm', label: 'RM' },
  { key: 'coordinator', label: 'Coordinator' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'region', label: 'CRA Region' },
]

const LENS_NOUNS = {
  province: ['province', 'provinces'],
  rm: ['regional manager', 'regional managers'],
  coordinator: ['coordinator', 'coordinators'],
  contractor: ['contractor', 'contractors'],
  region: ['CRA region', 'CRA regions'],
}

/** How many owner rows the panel lists before folding the rest into one. */
export const TOP_ROWS = 6

/**
 * Whether a gap has data to show. The two Mojri gaps have none until Mojri's
 * tracker has been imported at least once: then the page says so rather than
 * reporting every approved village as "missing".
 */
export function hasData(key, data) {
  return !(GAPS[key].mojri && !data.last_mojri_import)
}

/**
 * The one scale all six columns share: the largest bar or base drawn on the
 * card. The tallest solid column is then the biggest gap on the page.
 */
export function chartMax(data) {
  let most = 0
  for (const [key, meta] of Object.entries(GAPS)) {
    if (!hasData(key, data)) continue
    const gap = data.gaps[key]
    most = Math.max(most, gap.count, meta.showBase ? gap.base : 0)
  }
  return most
}

/** A column's height as a percentage of the plot, on the shared scale. */
export function heightPct(value, max) {
  return max ? (value * 100) / max : 0
}

/** The one caption line above a column. */
export function columnCaption(key, data) {
  const meta = GAPS[key]
  if (!hasData(key, data)) return 'No Mojri import yet'
  const gap = data.gaps[key]
  if (meta.block === 'pending') return `${wholePct(gap.count, gap.base)} of ${fmt(gap.base)}`
  if (meta.mojri) return `Mojri has ${fmt(gap.in_tracker)} of ${fmt(gap.base)}`
  return `of ${fmt(gap.base)} ${meta.baseName}`
}

/** The panel's summary line: "2,042 villages · 42.4% of 4,812 drive-tested". */
export function summaryLine(key, data) {
  const gap = data.gaps[key]
  return (
    `${fmt(gap.count)} ${gap.count === 1 ? 'village' : 'villages'} · ` +
    `${onePct(gap.count, gap.base)} of ${fmt(gap.base)} ${GAPS[key].baseName}`
  )
}

/**
 * The owner rows the panel draws: the top six, and the rest folded into one
 * "N more" row, so the list fits without scrolling. Each row carries its
 * share of the gap (`share`) and its own rate (`rate`), which are two
 * different fractions of two different things.
 */
export function panelRows(rows, total, limit = TOP_ROWS) {
  const decorate = (row) => ({
    ...row,
    share: total ? (row.count * 100) / total : null,
    rate: row.base ? (row.count * 100) / row.base : null,
  })
  // Folding one row into "1 more" saves nothing; show it instead.
  const keep = rows.length > limit + 1 ? limit : rows.length
  const shown = rows.slice(0, keep).map(decorate)
  const rest = rows.slice(keep)
  const more = rest.length
    ? decorate({
        name: `${rest.length} more`,
        count: rest.reduce((sum, row) => sum + row.count, 0),
        base: rest.reduce((sum, row) => sum + row.base, 0),
        attribution: 'more',
        folded: rest.length,
      })
    : null
  return { shown, more }
}

/**
 * The footer line: the rows, added up in the browser, against the gap's
 * total. Printed whether or not it balances -- a check that only appears when
 * it passes is decoration.
 */
export function checksum(rows, total, lens) {
  const sum = rows.reduce((acc, row) => acc + row.count, 0)
  const [one, many] = LENS_NOUNS[lens] ?? ['row', 'rows']
  const noun = rows.length === 1 ? one : many
  if (sum === total) {
    const lead = rows.length === 1 ? `The 1 ${noun} adds` : `All ${rows.length} ${noun} add`
    return { ok: true, text: `${lead} up to ${fmt(total)}` }
  }
  return {
    ok: false,
    text:
      `The ${rows.length} ${noun} add up to ${fmt(sum)}, not the ${fmt(total)} total ` +
      `— a difference of ${fmt(Math.abs(total - sum))}. One of the two is wrong; ` +
      'do not act on this panel until it is.',
  }
}

/** The data-quality notes behind the page head's warning button. */
export function dataNotes(quality) {
  const notes = []
  if (quality?.villages_without_province > 0) {
    notes.push(
      `${fmt(quality.villages_without_province)} village(s) have no province, so no manager, ` +
        'coordinator or CRA region owns them. They are the "Unknown province" row.'
    )
  }
  if (quality?.unmapped_provinces?.length > 0) {
    notes.push(
      `No current owner in the province mapping for: ${quality.unmapped_provinces.join(', ')}. ` +
        'Their villages are the "Unmapped province" row.'
    )
  }
  return notes
}

/** "Mojri import: 12 Sep 2026 · 16 days ago", for the Mojri panels. */
export function mojriStamp(value, now = new Date()) {
  if (!value) return 'No Mojri import yet'
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return 'No Mojri import yet'
  const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const days = Math.max(0, Math.floor((now - when) / 86400000))
  const age = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  return `Mojri import: ${date} · ${age}`
}

/** How a row that belongs to nobody is explained where it is drawn. */
export const ATTRIBUTION_NOTES = {
  unknown_province: 'No province — the CPM province cell matched none of the 31',
  unmapped: 'No current owner in the province mapping',
  unassigned: 'No DT SC contractor on the work item',
}

export function fmt(value) {
  return value == null ? '—' : value.toLocaleString('en-US')
}

/** "42%": the first screen's rounding. */
export function wholePct(part, whole) {
  return whole ? `${Math.round((part * 100) / whole)}%` : '—'
}

/** "42.4%": the panel's rounding. */
export function onePct(part, whole) {
  return whole ? `${((part * 100) / whole).toFixed(1)}%` : '—'
}
