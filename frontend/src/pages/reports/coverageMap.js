// Coverage map: the arithmetic the map does in the browser.
//
// Everything is derived from one `/gaps/map` response and the committed map
// asset (`iranMap.json`, built by `scripts/build-iran-map.py`). The two are
// joined on the province's Persian name -- the CPM province, exactly as the
// `provinces` table stores it -- never on a translated or fuzzy-matched name.
// Kept out of the component so each rule can be tested on its own.

/**
 * The six approval bands, low to high. Fixed, not fitted to the data, so a
 * colour means the same approval rate on both maps, in the table, and from
 * one month to the next.
 *
 * Six shades of the UEP blue, light = low, dark = high (UEP-13 §3.8): no red
 * and no green, because red means late and green means approved. Mirrored as
 * --uep-map-1…6 in uep-tokens.css (SVG fill attributes cannot read a CSS
 * variable, so the map data holds the values). `ink` is the label colour:
 * deep blue on the light bands, white on the dark ones, each ≥ 4.5:1.
 */
export const BANDS = [
  { below: 25, label: '< 25%', fill: '#E3EAFB', ink: '#0F1F4B', dark: false },
  { below: 40, label: '25–40%', fill: '#BFD0F6', ink: '#0F1F4B', dark: false },
  { below: 55, label: '40–55%', fill: '#8DABEF', ink: '#0F1F4B', dark: false },
  { below: 70, label: '55–70%', fill: '#4270E1', ink: '#FFFFFF', dark: true },
  { below: 85, label: '70–85%', fill: '#2A55D6', ink: '#FFFFFF', dark: true },
  { below: Infinity, label: '85%+', fill: '#14318F', ink: '#FFFFFF', dark: true },
]

/**
 * The approval rate on one stretch: the share of what reached it that got
 * past it. ICT: ICT-approved over drive-test-done. CRA: CRA-approved over
 * ICT-approved.
 *
 * The server sends the stop rate; approval is its complement, worked from the
 * two counts rather than from the rounded rate so it is exact.
 */
export function approvalRate(figures) {
  if (!figures || !figures.reached) return null
  return ((figures.reached - figures.stopped) * 100) / figures.reached
}

/**
 * The band a stretch's figures fall in, or null when they are not compared:
 * nothing reached, or fewer than the low-sample threshold. Null is drawn as
 * the hatch.
 */
export function bandOf(figures) {
  const rate = approvalRate(figures)
  if (rate == null || figures.low_sample) return null
  return BANDS.find((band) => rate < band.below)
}

/** "70%" on the map, where there is room for two or three characters. */
export function wholePct(rate) {
  return rate == null ? '—' : `${Math.round(rate)}%`
}

/** "70.4%" in the table and the detail panel. */
export function onePct(rate) {
  return rate == null ? '—' : `${rate.toFixed(1)}%`
}

/**
 * Provinces whose live mapping region differs from the region the map asset
 * was built with.
 *
 * The region borders are dissolved once, offline, from the directory's
 * grouping. If a province is moved to another region in the mapping screen,
 * the figures follow the move at once and the border does not, so the page
 * says so rather than drawing a border that no longer matches the table.
 */
export function regionDrift(provinces, asset) {
  return provinces
    .filter((row) => row.key && asset.provinces[row.key] && row.region)
    .filter((row) => asset.provinces[row.key].region !== row.region)
    .map((row) => ({ name: row.name, now: row.region, drawn: asset.provinces[row.key].region }))
}

/* ---------------------------------------------------------------------------
   The detail panel. Every figure is {sites, villages}. ICT and CRA count like
   the Gaps tab (approved and pending over the drive-tested villages), so each
   village count exports exactly -- see `/gaps/villages.xlsx`.
   --------------------------------------------------------------------------- */

/** The two maps, one at a time. */
export const MAPS = [
  { key: 'ict', label: 'ICT approval · by province', authority: 'ICT', shape: 'province' },
  { key: 'cra', label: 'CRA approval · by region', authority: 'CRA', shape: 'region' },
]

/** The export key behind each panel village count. Site counts are plain. */
export const PANEL_GAPS = {
  ict: { approved: 'ict_approved', pending: 'pending_ict' },
  cra: { approved: 'cra_approved', pending: 'pending_cra' },
}

/** The drive-tested villages one authority's figures are over. */
export function detailBase(figures) {
  return figures ? figures.approved.villages + figures.pending.villages : 0
}

/** Approval over the drive-tested villages, as a percentage, or null. */
export function detailRate(figures) {
  const base = detailBase(figures)
  return base ? (figures.approved.villages * 100) / base : null
}

/**
 * The band for a detail figure, or null when it is not compared (nothing
 * drive-tested, or fewer than the low-sample threshold) -- the map's rule,
 * applied to the detail's own counts.
 */
export function detailBand(figures, threshold) {
  const rate = detailRate(figures)
  if (rate == null || detailBase(figures) < threshold) return null
  return BANDS.find((band) => rate < band.below)
}
