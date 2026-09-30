// Lifecycle Gaps: the arithmetic the page does in the browser.
//
// Everything here is derived from one `/gaps/overview` response and nothing
// else. Kept out of the components so each rule can be tested on its own.
//
// The live checksum is the one rule that matters most: the drawer adds up the
// rows it is about to draw and says out loud whether they make the gap's
// total. A design preview of this page once showed 2,570 at the top beside an
// owner list adding to 445, and it reached a person because nothing on the
// screen ever added the rows up.

/**
 * The three cards of the Gaps tab, in order. ICT is always the left tile and
 * CRA the right one, in every card.
 */
export const CARDS = [
  {
    key: 'pending',
    title: 'Pending approval',
    description: 'Drive-tested villages still waiting',
    gaps: ['pending_ict', 'pending_cra'],
  },
  {
    key: 'remained',
    title: 'One approved, other pending',
    description: "One authority has signed, the other hasn't",
    gaps: ['ict_remained', 'cra_remained'],
  },
  {
    key: 'mojri',
    title: 'ICT vs CRA vs Mojri tracker',
    description: 'Every approved village (CPM + in-app) missing in Mojri',
    gaps: ['ict_missing_in_mojri', 'cra_missing_in_mojri'],
  },
]

/**
 * One entry per gap the API returns.
 *
 * `tileLabel` is the word beside the authority chip on the tile. `title` is
 * the drawer's heading and the export's description. `baseName` names what
 * the base counts ("of 2,555 CRA-approved"). `approvedGap` is the export key
 * of a Mojri gap's base -- the "approved in UEP" count shown before any
 * Mojri import. That base is every approved village, on air or not (the same
 * villages the Mojri template lists), not the on-air count card 2 uses.
 */
export const GAPS = {
  pending_ict: {
    authority: 'ICT', card: 'pending', tileLabel: 'Pending', short: 'pending',
    title: 'Pending ICT approval', baseName: 'drive-tested',
  },
  pending_cra: {
    authority: 'CRA', card: 'pending', tileLabel: 'Pending', short: 'pending',
    title: 'Pending CRA approval', baseName: 'drive-tested',
  },
  ict_remained: {
    authority: 'ICT', card: 'remained', tileLabel: 'Pending', short: 'remained',
    title: 'ICT pending, CRA approved', baseName: 'CRA-approved',
  },
  cra_remained: {
    authority: 'CRA', card: 'remained', tileLabel: 'Pending', short: 'remained',
    title: 'CRA pending, ICT approved', baseName: 'ICT-approved',
  },
  ict_missing_in_mojri: {
    authority: 'ICT', card: 'mojri', tileLabel: 'Not in Mojri', short: 'not in Mojri',
    title: 'ICT approved, missing in Mojri', baseName: 'approved in UEP',
    mojri: true, approvedGap: 'ict_approved_all',
  },
  cra_missing_in_mojri: {
    authority: 'CRA', card: 'mojri', tileLabel: 'Not in Mojri', short: 'not in Mojri',
    title: 'CRA approved, missing in Mojri', baseName: 'approved in UEP',
    mojri: true, approvedGap: 'cra_approved_all',
  },
}

/** What an export key that is not one of the six gaps is called. */
const EXPORT_TITLES = {
  ict_approved: 'ICT approved',
  cra_approved: 'CRA approved',
  ict_approved_all: 'ICT approved in UEP',
  cra_approved_all: 'CRA approved in UEP',
}

/** The drawer's "Group by" options, in the order the design gives them. */
export const LENSES = [
  { key: 'coordinator', label: 'Coordinator' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
  { key: 'region', label: 'CRA region' },
  { key: 'rm', label: 'Regional manager' },
]

const LENS_NOUNS = {
  province: ['province', 'provinces'],
  rm: ['regional manager', 'regional managers'],
  coordinator: ['coordinator', 'coordinators'],
  contractor: ['contractor', 'contractors'],
  region: ['CRA region', 'CRA regions'],
}

/** The lens's name in a sentence: "coordinator" / "coordinators". */
export function lensNoun(lens, count) {
  const [one, many] = LENS_NOUNS[lens] ?? ['row', 'rows']
  return count === 1 ? one : many
}

/** The lens's name on a label: "Coordinator". */
export function lensLabel(lens) {
  return LENSES.find((option) => option.key === lens)?.label ?? lens
}

/**
 * Whether a gap has data to show. The two Mojri gaps have none until Mojri's
 * tracker has been imported at least once: then the page says so rather than
 * reporting every approved village as "missing".
 */
export function hasData(key, data) {
  return !(GAPS[key].mojri && !data.last_mojri_import)
}

/* ---------------------------------------------------------------------------
   The waffle: 100 squares, the base.
   --------------------------------------------------------------------------- */

/** How many of the waffle's 100 squares are the gap. */
export function waffleFilled(count, base, squares = 100) {
  if (!base || !count) return 0
  return Math.min(squares, Math.max(0, Math.round((count * squares) / base)))
}

/**
 * What one square stands for. Every tile has its own base, so two waffles
 * with the same number of squares filled can be very different numbers of
 * villages -- the note is what stops them being compared as equal.
 */
export function scaleNote(base) {
  if (!base) return 'Nothing counted yet'
  const per = Math.round(base / 100)
  if (per < 1) return `100 squares = ${fmt(base)} ${base === 1 ? 'village' : 'villages'}`
  return `1 square ≈ ${fmt(per)} ${per === 1 ? 'village' : 'villages'}`
}

/**
 * "13%", "of 4,433" and "drive-tested": the tile's share line, in parts, so
 * the base's name can be kept whole (it would otherwise break at its hyphen).
 */
export function shareParts(key, gap) {
  return { pct: wholePct(gap.count, gap.base), of: `of ${fmt(gap.base)}`, name: GAPS[key].baseName }
}

/* ---------------------------------------------------------------------------
   The drawer: who is holding it.
   --------------------------------------------------------------------------- */

/**
 * The drawer's rows, each with its share of the gap (0-100) and how many of
 * the mark's 20 squares that is. Every row is listed: the drawer's list
 * scrolls, so nothing is folded away.
 */
export function drawerRows(rows, total) {
  return rows.map((row) => {
    const share = total ? (row.count * 100) / total : null
    return { ...row, share, marks: waffleFilled(row.count, total, 20) }
  })
}

/** "13 coordinators hold these 1,391 villages", in parts for the markup. */
export function holdersParts(rows, lens, total) {
  const holding = rows.filter((row) => row.count > 0).length
  return {
    holders: fmt(holding),
    noun: lensNoun(lens, holding),
    verb: holding === 1 ? 'holds' : 'hold',
    total: fmt(total),
    villages: total === 1 ? 'village' : 'villages',
  }
}

/**
 * The footer's check: the rows, added up in the browser, against the gap's
 * total. Printed whether or not it balances -- a check that only appears when
 * it passes is decoration.
 */
export function checksum(rows, total) {
  const sum = rows.reduce((acc, row) => acc + row.count, 0)
  if (sum === total) return { ok: true, sum, text: `Adds up to ${fmt(total)}` }
  return {
    ok: false,
    sum,
    text:
      `The rows add up to ${fmt(sum)}, not ${fmt(total)} — a difference of ` +
      `${fmt(Math.abs(total - sum))}. Do not act on this list until it is fixed.`,
  }
}

/* ---------------------------------------------------------------------------
   Export: what a clicked number is, in words.
   --------------------------------------------------------------------------- */

/** "CRA pending", "ICT not in Mojri", "ICT approved": the export's name for a gap. */
export function gapShortName(gap) {
  const meta = GAPS[gap]
  if (meta) return `${meta.authority} ${meta.short}`
  return EXPORT_TITLES[gap] ?? gap
}

/**
 * "CRA pending · Coordinator V. Hashemi": what an export holds. The filter
 * parts are optional; the gap is not.
 */
export function exportDescription({ gap, lens, keyValue, scopeLabel }) {
  const parts = [gapShortName(gap)]
  if (scopeLabel) parts.push(scopeLabel)
  if (lens && keyValue) parts.push(`${lensLabel(lens)} ${keyValue}`)
  return parts.join(' · ')
}

/* ---------------------------------------------------------------------------
   Around the page.
   --------------------------------------------------------------------------- */

/** The data-quality notes behind the page bar's warning button. */
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

/** "Mojri import: 12 Sep 2026 · 16 days ago", for the Mojri drawers. */
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

/** "42%": the tiles' rounding. */
export function wholePct(part, whole) {
  return whole ? `${Math.round((part * 100) / whole)}%` : '—'
}

/** "42.4%": the drawer's rounding. */
export function onePct(part, whole) {
  return whole ? `${((part * 100) / whole).toFixed(1)}%` : '—'
}
