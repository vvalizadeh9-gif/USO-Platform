// Coverage map: the arithmetic the map does in the browser.
//
// Everything is derived from one `/gaps/map` response and the committed map
// asset (`iranMap.json`, built by `scripts/build-iran-map.py`). The two are
// joined on the province's Persian name -- the CPM province, exactly as the
// `provinces` table stores it -- never on a translated or fuzzy-matched name.
// Kept out of the component so each rule can be tested on its own.

/**
 * The six approval bands, worst to best. Fixed, not fitted to the data, so a
 * colour means the same approval rate on both maps, in the table, and from
 * one month to the next.
 *
 * `ink` is the label colour that stays readable on each fill.
 */
export const BANDS = [
  { below: 25, label: '< 25%', fill: '#8B2323', ink: '#FFFFFF' },
  { below: 40, label: '25–40%', fill: '#C0522E', ink: '#FFFFFF' },
  { below: 55, label: '40–55%', fill: '#E0A030', ink: '#3A2A08' },
  { below: 70, label: '55–70%', fill: '#9DC75B', ink: '#1F3310' },
  { below: 85, label: '70–85%', fill: '#2E9E82', ink: '#FFFFFF' },
  { below: Infinity, label: '85%+', fill: '#0A6B5E', ink: '#FFFFFF' },
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

/**
 * The region report, worst CRA approval first -- the order the mockup reads
 * in, so the region to call is at the top. Regions nobody owns (no province,
 * no mapping) go last whatever their figures, and a region with nothing to
 * compare sorts after every region that has.
 */
export function reportOrder(regions) {
  const rank = (row) => {
    if (row.attribution !== 'owned') return [2, 0, row.name]
    const rate = approvalRate(row.cra)
    return rate == null ? [1, 0, row.name] : [0, rate, row.name]
  }
  return [...regions].sort((a, b) => {
    const [ga, ra, na] = rank(a)
    const [gb, rb, nb] = rank(b)
    return ga - gb || ra - rb || na.localeCompare(nb)
  })
}
