import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import api from '../../api/client'
import { EmptyState } from '../../components/ui'
import { fmtCount, fmtPct } from './kpiTheme'
import { decorate, rateFraction } from './gapRoad'
import {
  BAND_COLOURS,
  approvalRate,
  bands,
  borderPath,
  fillOf,
  fillPath,
  groupCells,
  viewBox,
} from './coverageMap'
import { OwnerList, Skeleton } from './GapRoad'

/**
 * Lifecycle Gaps → Coverage map.
 *
 * Iran twice, side by side: ICT approval coloured by province, CRA approval
 * coloured by CRA region. The same figures as the road tab -- the server folds
 * the same grid -- drawn where they are, so a PM sees where a gap sits before
 * reading a table.
 *
 * The shapes are built from the CPM site coordinates, binned into hexes on
 * the server. A region is the hexes of its provinces, so CRA is never drawn
 * per province: its nine shapes are drawn with no edges inside them.
 *
 * Three rules:
 *
 * **Colour is never the only carrier of a number.** Hovering, focusing or
 * tapping a shape prints its name, stopped, reached and rate as text under the
 * map, and clicking opens the figures in full.
 *
 * **One legend for both maps.** The bands are computed from both maps' rows
 * together, so a colour means the same approval rate on either side.
 *
 * **Low-sample shapes are hatched, not coloured,** and are left out before the
 * bands are computed. The threshold is the KPI page's, sent by the server.
 *
 * Scope is the server's: a PM gets the country, everyone else only their own
 * sites and figures.
 */
// Module-level so the memoised geometry below is not rebuilt on every hover.
const byProvince = (cell) => cell.province
const byRegion = (cell) => cell.region

export default function CoverageMap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [province, setProvince] = useState(null)
  const [region, setRegion] = useState(null)

  useEffect(() => {
    let live = true
    api
      .get('/gaps/map')
      .then((r) => live && setData(r.data))
      .catch((err) => {
        if (!live) return
        const detail = err?.response?.data?.detail
        setError(typeof detail === 'string' ? detail : 'Could not load the coverage map.')
      })
    return () => {
      live = false
    }
  }, [])

  const scale = useMemo(
    () => (data ? bands([...data.ict.provinces, ...data.cra.regions]) : null),
    [data]
  )

  if (error) {
    return (
      <div className="card card-pad">
        <EmptyState title="Nothing to show" hint={error} />
      </div>
    )
  }
  if (!data) return <Skeleton />

  const threshold = data.low_sample_threshold
  const provinceRow = data.ict.provinces.find((row) => row.name === province)
  const regionRow = data.cra.regions.find((row) => row.name === region)

  return (
    <>
      {data.scoped && (
        <p className="kpi-banner">
          <Info size={16} aria-hidden="true" />
          Showing your own sites only — {data.lens_label} <strong>{data.key}</strong>.
        </p>
      )}

      <OffMap data={data} />

      <div className="gap-maps">
        <MapCard
          id="ict"
          title="ICT approval, by province"
          stretch="ICT"
          rows={data.ict.provinces}
          cells={data.cells}
          keyOf={byProvince}
          scale={scale}
          selected={province}
          onSelect={setProvince}
        >
          {provinceRow && (
            <ProvinceDetail
              row={provinceRow}
              region={data.cells.find((cell) => cell.province === province)?.region}
              threshold={threshold}
              onClose={() => setProvince(null)}
            />
          )}
        </MapCard>

        <MapCard
          id="cra"
          title="CRA approval, by CRA region"
          stretch="CRA"
          rows={data.cra.regions}
          cells={data.cells}
          keyOf={byRegion}
          scale={scale}
          selected={region}
          onSelect={setRegion}
        >
          {regionRow && (
            <RegionDetail
              row={regionRow}
              threshold={threshold}
              onClose={() => setRegion(null)}
            />
          )}
        </MapCard>
      </div>

      <Legend scale={scale} threshold={threshold} />
    </>
  )
}

/** "Tehran — ICT approval 71.4% · 4 stopped of 14 reached". */
function shapeText(name, row, stretch) {
  if (!row) return name
  const approval = approvalRate(row)
  return (
    `${name} — ${stretch} approval ${fmtPct(approval)} · ` +
    `${fmtCount(row.stopped)} stopped of ${fmtCount(row.reached)} reached` +
    (row.low_sample ? ' · too few villages to compare' : '')
  )
}

function MapCard({ id, title, stretch, rows, cells, keyOf, scale, selected, onSelect, children }) {
  const [hover, setHover] = useState(null)

  const shaped = useMemo(() => cells.filter((cell) => keyOf(cell) != null), [cells, keyOf])
  const groups = useMemo(() => groupCells(shaped, keyOf), [shaped, keyOf])
  const borders = useMemo(() => borderPath(shaped, keyOf), [shaped, keyOf])
  const box = useMemo(() => viewBox(shaped), [shaped])
  const byName = useMemo(() => new Map(rows.map((row) => [row.name, row])), [rows])

  const readout = hover ?? selected
  const hatch = `gap-hatch-${id}`
  const pick = (name) => onSelect(selected === name ? null : name)

  return (
    <section className="card card-pad kpi-card gap-map-card" data-testid={`gap-map-${id}`}>
      <h3 className="kpi-card-title">{title}</h3>

      {box ? (
        <svg className="gap-map" viewBox={box} role="group" aria-label={title}>
          <defs>
            <Hatch id={hatch} />
          </defs>
          {[...groups].map(([name, group]) => {
            const row = byName.get(name)
            const fill = fillOf(row, scale)
            const text = shapeText(name, row, stretch)
            return (
              <g
                key={name}
                className={`gap-map-shape ${selected === name ? 'selected' : ''}`}
                data-shape={name}
                data-hatched={fill == null}
                role="button"
                tabIndex={0}
                aria-pressed={selected === name}
                aria-label={text}
                onMouseEnter={() => setHover(name)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(name)}
                onBlur={() => setHover(null)}
                onClick={() => pick(name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    pick(name)
                  }
                }}
              >
                <title>{text}</title>
                <path d={fillPath(group)} fill={fill ?? `url(#${hatch})`} />
              </g>
            )
          })}
          <path d={borders} className="gap-map-border" />
          {selected && groups.has(selected) && (
            <path d={borderPath(groups.get(selected), () => 1)} className="gap-map-outline" />
          )}
        </svg>
      ) : (
        <EmptyState
          title="No located sites"
          hint="None of the sites in scope has a CPM latitude and longitude inside Iran."
        />
      )}

      <p className="gap-map-readout" aria-live="polite">
        {readout
          ? shapeText(readout, byName.get(readout), stretch)
          : 'Hover or tap a shape for its numbers; click it for the detail.'}
      </p>

      {children}
    </section>
  )
}

function Hatch({ id }) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width="5"
      height="5"
      patternTransform="rotate(45)"
    >
      <rect width="5" height="5" className="gap-hatch-bg" />
      <line x1="0" y1="0" x2="0" y2="5" className="gap-hatch-line" />
    </pattern>
  )
}

function DetailHead({ title, sub, onClose }) {
  return (
    <header className="gap-map-detail-head">
      <div>
        <strong>{title}</strong>
        {sub && <span className="kpi-region">{sub}</span>}
      </div>
      <button type="button" className="gap-map-close" onClick={onClose} aria-label="Close detail">
        <X size={15} aria-hidden="true" />
      </button>
    </header>
  )
}

function Figures({ row, start, stretch }) {
  const approved = row.reached - row.stopped
  return (
    <dl className="gap-map-figures">
      <div>
        <dt>Reached {start}</dt>
        <dd>{fmtCount(row.reached)}</dd>
      </div>
      <div>
        <dt>Stopped before {stretch}</dt>
        <dd>{fmtCount(row.stopped)}</dd>
      </div>
      <div>
        <dt>{stretch} approval</dt>
        <dd>
          {fmtPct(approvalRate(row))}
          <em>
            {fmtCount(approved)} of {fmtCount(row.reached)} approved
          </em>
        </dd>
      </div>
      <div>
        <dt>Own stop rate</dt>
        <dd>
          {fmtPct(row.rate)}
          <em>{rateFraction(row)}</em>
        </dd>
      </div>
    </dl>
  )
}

function LowSampleNote({ row, threshold }) {
  if (!row.low_sample) return null
  return (
    <p className="kpi-note gap-map-low">
      Fewer than {threshold} villages reached this stretch, so it is hatched rather
      than coloured and not compared.
    </p>
  )
}

function ProvinceDetail({ row, region, threshold, onClose }) {
  return (
    <div className="gap-map-detail" role="region" aria-label={`${row.name} detail`}>
      <DetailHead title={row.name} sub={region ? `${region} region` : null} onClose={onClose} />
      <Figures row={row} start="drive test done" stretch="ICT" />
      <LowSampleNote row={row} threshold={threshold} />
    </div>
  )
}

function RegionDetail({ row, threshold, onClose }) {
  const members = decorate(row.members, row.stopped)
  return (
    <div className="gap-map-detail" role="region" aria-label={`${row.name} region detail`}>
      <DetailHead title={`${row.name} region`} sub="CRA approval" onClose={onClose} />
      <Figures row={row} start="ICT approved" stretch="CRA" />
      <LowSampleNote row={row} threshold={threshold} />
      <OwnerList
        rows={members}
        lensLabel="Province"
        scoped={false}
        shareLabel="% of region"
        pareto={false}
      />
    </div>
  )
}

function Legend({ scale, threshold }) {
  const fmtEdge = (value) => `${Number(value.toFixed(1))}`
  return (
    <section className="card card-pad kpi-card gap-map-legend" aria-label="Colour key">
      <div className="gap-legend-row">
        <span className="gap-legend-title">Approval rate, both maps</span>
        {scale &&
          BAND_COLOURS.map((colour, index) => (
            <span key={colour} className="gap-legend-item" data-testid="gap-legend-band">
              <span className="gap-swatch" style={{ background: colour }} aria-hidden="true" />
              {fmtEdge(scale.edges[index])}–{fmtEdge(scale.edges[index + 1])}%
            </span>
          ))}
        <span className="gap-legend-item">
          <svg className="gap-swatch" viewBox="0 0 14 14" aria-hidden="true">
            <defs>
              <Hatch id="gap-hatch-legend" />
            </defs>
            <rect width="14" height="14" fill="url(#gap-hatch-legend)" />
          </svg>
          Fewer than {threshold} reached — not compared
        </span>
      </div>
      <p className="kpi-note">
        {scale
          ? `The bands divide the range of the provinces and regions that can be compared, ${fmtEdge(scale.lo)}% to ${fmtEdge(scale.hi)}%, into five. Red is lowest approval, where the gap is; teal is highest.`
          : 'No province or region has enough villages to compare yet, so every shape is hatched.'}{' '}
        Shapes are drawn from the CPM coordinates of the sites in scope; a blank area
        has no site.
      </p>
    </section>
  )
}

/**
 * What the figures count and the map cannot draw, named rather than missing:
 * rows with no province or no mapping owner, provinces and regions with no
 * located site, and sites whose coordinates are absent or outside Iran.
 */
function OffMap({ data }) {
  const notes = []
  const unowned = [
    ...data.ict.provinces.filter((row) => row.attribution !== 'owned').map((row) => [row, 'ICT']),
    ...data.cra.regions.filter((row) => row.attribution !== 'owned').map((row) => [row, 'CRA']),
  ]
  for (const [row, stretch] of unowned) {
    if (row.reached === 0 && row.stopped === 0) continue
    notes.push(
      `${row.name}: ${fmtCount(row.stopped)} stopped before ${stretch} of ${fmtCount(row.reached)} reached, not on the map.`
    )
  }
  const quality = data.data_quality
  if (quality.provinces_without_shape.length > 0) {
    notes.push(`No located site, so no shape: ${quality.provinces_without_shape.join(', ')}.`)
  }
  if (quality.regions_without_shape.length > 0) {
    notes.push(`CRA regions with no located site: ${quality.regions_without_shape.join(', ')}.`)
  }
  if (quality.sites_without_location > 0) {
    notes.push(
      `${fmtCount(quality.sites_without_location)} site(s) have no CPM coordinates inside Iran and are not drawn; their villages are still in the figures.`
    )
  }
  if (notes.length === 0) return null
  return (
    <div className="kpi-banner warn gap-quality" data-testid="gap-map-offmap">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        {notes.map((note) => (
          <span key={note}>{note} </span>
        ))}
      </span>
    </div>
  )
}
