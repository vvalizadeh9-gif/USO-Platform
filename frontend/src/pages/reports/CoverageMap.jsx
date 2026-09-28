import { Fragment, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Info, X } from 'lucide-react'
import api from '../../api/client'
import { EmptyState } from '../../components/ui'
import { fmtCount } from './kpiTheme'
import { ATTRIBUTION_NOTES } from './lifecycleGaps'
import {
  BANDS,
  approvalRate,
  bandOf,
  onePct,
  regionDrift,
  reportOrder,
  wholePct,
} from './coverageMap'
import iranMap from './iranMap.json'
import { Skeleton } from './LifecycleGaps'

/**
 * Lifecycle Gaps → Coverage map.
 *
 * Iran twice, side by side: ICT approval by province, CRA approval by CRA
 * region -- each authority drawn at the level it works at. Under the maps, the
 * CRA region report: every region, its provinces one click away.
 *
 * Where a village is drawn is decided by its CPM province, the same province
 * every figure is grouped by. The borders are OpenStreetMap's, committed as
 * `iranMap.json` by `scripts/build-iran-map.py` and keyed by the Persian
 * province name, so the join with the API is the same string on both sides.
 * The nine region shapes were dissolved from the provinces once, offline.
 *
 * Three rules:
 *
 * **A number on every shape.** Each province and region prints its name and
 * approval rate; hovering gives the counts, clicking a province gives them in
 * full. Colour is never the only carrier.
 *
 * **One fixed scale.** Six bands, the same on both maps and in the table.
 *
 * **Low sample is hatched, not coloured.** The KPI page's threshold, sent by
 * the server.
 *
 * Scope is the server's. A PM sees the country; anyone else sees the whole
 * map with only their own provinces and regions coloured.
 */
export default function CoverageMap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [province, setProvince] = useState(null)
  const [open, setOpen] = useState(() => new Set())

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

  const byKey = useMemo(
    () => new Map((data?.provinces ?? []).filter((r) => r.key).map((r) => [r.key, r])),
    [data]
  )
  const byRegion = useMemo(
    () => new Map((data?.regions ?? []).map((r) => [r.name, r])),
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

  const toggle = (name) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const openRegion = (name) => {
    setOpen((current) => new Set(current).add(name))
    document.getElementById(`cov-region-${name}`)?.scrollIntoView?.({ block: 'nearest' })
  }

  const drift = regionDrift(data.provinces, iranMap)
  const threshold = data.low_sample_threshold

  return (
    <section className="card card-pad kpi-card cov">
      <h2 className="cov-title">Coverage map</h2>
      <p className="cov-sub">
        ICT is decided by province offices, CRA by the nine region offices. Each map is
        drawn at the level its authority actually works. Click a region to open its
        provinces.
      </p>

      {data.scoped && (
        <p className="kpi-banner">
          <Info size={16} aria-hidden="true" />
          Showing your own scope only — {data.lens_label} <strong>{data.key}</strong>.
          Grey provinces and regions are outside it.
        </p>
      )}

      {drift.length > 0 && (
        <p className="kpi-banner warn" data-testid="cov-drift">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            The province mapping has moved{' '}
            {drift.map((d) => `${d.name} to ${d.now}`).join(', ')}. The figures follow
            the mapping; the region borders on the map still show the original
            grouping ({drift.map((d) => `${d.name} in ${d.drawn}`).join(', ')}) until the
            map asset is rebuilt.
          </span>
        </p>
      )}

      <div className="cov-scale" role="list" aria-label="Approval rate bands">
        {BANDS.map((band) => (
          <span
            key={band.label}
            role="listitem"
            className="cov-scale-band"
            style={{ background: band.fill, color: band.ink }}
          >
            {band.label}
          </span>
        ))}
      </div>
      <p className="cov-caption">
        ICT: share of drive-test-done villages ICT-approved. CRA: share of ICT-approved
        villages CRA-approved. Hatched = fewer than {threshold} reached, not compared.
      </p>

      <div className="cov-maps">
        <figure className="cov-map" data-testid="cov-map-ict">
          <figcaption className="cov-map-title">ICT approved — by province</figcaption>
          <MapLayer
            label="ICT approval by province"
            stretch="ICT"
            shapes={Object.entries(iranMap.provinces).map(([key, shape]) => ({
              id: key,
              name: shape.en,
              ...shape,
              figures: byKey.get(key)?.ict,
            }))}
            picked={province ? [province] : []}
            onPick={(key) => setProvince(province === key ? null : key)}
            small
          />
        </figure>

        <figure className="cov-map" data-testid="cov-map-cra">
          <figcaption className="cov-map-title">CRA approved — by region</figcaption>
          <MapLayer
            label="CRA approval by region"
            stretch="CRA"
            shapes={Object.entries(iranMap.regions).map(([name, shape]) => ({
              id: name,
              name,
              ...shape,
              figures: byRegion.get(name)?.cra,
            }))}
            picked={[...open]}
            onPick={openRegion}
            region
          />
        </figure>
      </div>

      <ProvinceDetail
        row={province ? byKey.get(province) : null}
        threshold={threshold}
        onClose={() => setProvince(null)}
      />

      <RegionReport data={data} byKey={byKey} open={open} onToggle={toggle} />

      <p className="cov-foot">
        A region figure is the sum of its provinces, never a separate calculation, so this
        table and the map cannot disagree. Villages are placed by their CPM province.
        Boundaries © OpenStreetMap contributors, available under the Open Database
        License (ODbL), via geoBoundaries.
      </p>
    </section>
  )
}

/** The diagonal hatch for a shape that is shown but not compared. */
function Hatch() {
  return (
    <defs>
      <pattern
        id="cov-hatch"
        patternUnits="userSpaceOnUse"
        width="8"
        height="8"
        patternTransform="rotate(45)"
      >
        <rect width="8" height="8" className="cov-hatch-bg" />
        <line x1="0" y1="0" x2="0" y2="8" className="cov-hatch-line" />
      </pattern>
    </defs>
  )
}

const MAP_WIDTH = Number(iranMap.viewBox.split(' ')[2])

/**
 * Keep a centred label inside the map: a province on the border (West
 * Azerbaijan, Sistan & Baluchestan) would otherwise have its name cut off at
 * the edge. The half-width is estimated from the name's length at the label's
 * font size -- close enough for a margin.
 */
function labelX(x, name, small) {
  const half = (name.length * (small ? 6.9 : 9.4)) / 2 + 4
  return Math.min(Math.max(x, half), MAP_WIDTH - half)
}

/** Name, approval and the counts behind it, for the tooltip and screen readers. */
function describe(name, figures, stretch) {
  if (!figures) return `${name} — outside your scope`
  const rate = approvalRate(figures)
  return (
    `${name} — ${stretch} approval ${onePct(rate)}: ` +
    `${fmtCount(figures.reached - figures.stopped)} of ${fmtCount(figures.reached)} approved, ` +
    `${fmtCount(figures.stopped)} stopped` +
    (figures.low_sample ? ' (too few to compare)' : '')
  )
}

/**
 * One map: every shape, then the outline of whatever is picked, then every
 * label -- in that order, so no neighbouring shape is painted over an outline
 * or a label.
 */
function MapLayer({ label, stretch, shapes, picked, onPick, small, region }) {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]))
  return (
    <svg viewBox={iranMap.viewBox} role="group" aria-label={label}>
      <Hatch />
      {shapes.map((shape) => (
        <Shape
          key={shape.id}
          shape={shape}
          stretch={stretch}
          selected={picked.includes(shape.id)}
          onPick={() => onPick(shape.id)}
          region={region}
        />
      ))}
      {picked
        .filter((id) => byId.has(id))
        .map((id) => (
          <path key={id} d={byId.get(id).path} className="cov-outline" />
        ))}
      {shapes.map((shape) => (
        <Label key={shape.id} shape={shape} small={small} />
      ))}
    </svg>
  )
}

function Shape({ shape, stretch, selected, onPick, region }) {
  const { id, name, path, figures } = shape
  const band = bandOf(figures)
  // Three states: coloured by band; hatched (in scope, not comparable); grey
  // (outside this account's scope -- no figures were sent for it at all).
  const fill = band ? band.fill : figures ? 'url(#cov-hatch)' : 'var(--surface-3)'
  const text = describe(name, figures, stretch)
  const state = band ? 'coloured' : figures ? 'hatched' : 'outside'

  return (
    <g
      className={`cov-shape ${region ? 'is-region' : ''}`}
      data-shape={id}
      data-state={state}
      role="button"
      tabIndex={figures ? 0 : -1}
      aria-label={text}
      aria-pressed={selected}
      onClick={figures ? onPick : undefined}
      onKeyDown={(event) => {
        if (figures && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onPick()
        }
      }}
    >
      <title>{text}</title>
      <path d={path} fill={fill} fillRule="evenodd" />
    </g>
  )
}

function Label({ shape, small }) {
  const { name, label, figures } = shape
  const band = bandOf(figures)
  const x = labelX(label[0], name, small)
  return (
    <text
      x={x}
      y={label[1]}
      // A halo in the opposite tone keeps a label readable where it spills
      // past its own shape -- onto a neighbour, or onto the page.
      className={`cov-label ${small ? 'small' : ''} ${band?.ink === '#FFFFFF' ? 'on-dark' : ''}`}
      style={{ fill: band ? band.ink : 'var(--text)' }}
      aria-hidden="true"
    >
      <tspan x={x} dy="-0.2em" className="cov-label-name">
        {name}
      </tspan>
      {figures && (
        <tspan x={x} dy="1.15em" className="cov-label-pct">
          {wholePct(approvalRate(figures))}
        </tspan>
      )}
    </text>
  )
}

function ProvinceDetail({ row, threshold, onClose }) {
  if (!row) {
    return <p className="cov-hint">Click any province to see its numbers here.</p>
  }
  const { ict, cra } = row
  return (
    <div className="cov-detail" role="region" aria-label={`${row.name} detail`}>
      <header className="cov-detail-head">
        <div>
          <strong>{row.name}</strong>
          {row.region && <span className="kpi-region">{row.region} region</span>}
        </div>
        <button type="button" className="cov-close" onClick={onClose} aria-label="Close detail">
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <dl className="cov-figures">
        <Figure term="Drive test done" value={fmtCount(ict.reached)} />
        <Figure
          term="ICT approved"
          value={onePct(approvalRate(ict))}
          note={`${fmtCount(ict.reached - ict.stopped)} of ${fmtCount(ict.reached)}`}
        />
        <Figure term="Stopped before ICT" value={fmtCount(ict.stopped)} />
        <Figure
          term="CRA approved"
          value={onePct(approvalRate(cra))}
          note={`${fmtCount(cra.reached - cra.stopped)} of ${fmtCount(cra.reached)} ICT-approved`}
        />
        <Figure term="Stopped before CRA" value={fmtCount(cra.stopped)} />
      </dl>
      {ict.low_sample && (
        <p className="kpi-note cov-low">
          Fewer than {threshold} drive-test-done villages, so this province is hatched
          rather than coloured and is not compared.
        </p>
      )}
    </div>
  )
}

function Figure({ term, value, note }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        {value}
        {note && <em>{note}</em>}
      </dd>
    </div>
  )
}

/** The CRA % cell: the band colour behind the figure, as in the mockup. */
function BandPill({ figures }) {
  const band = bandOf(figures)
  const rate = approvalRate(figures)
  if (!band) return <span className="cov-pill plain">{onePct(rate)}</span>
  return (
    <span className="cov-pill" style={{ background: band.fill, color: band.ink }}>
      {onePct(rate)}
    </span>
  )
}

function RegionReport({ data, byKey, open, onToggle }) {
  const rows = reportOrder(data.regions)
  const owned = rows.filter((row) => row.attribution === 'owned')
  const provinceCount = owned.reduce((sum, row) => sum + row.provinces.length, 0)

  return (
    <div className="cov-report">
      <h3 className="cov-map-title">CRA region report — every province in the region, together</h3>
      <div className="kpi-table-wrap">
        <table className="cov-table">
          <thead>
            <tr>
              <th scope="col">CRA region</th>
              <th scope="col">Provinces</th>
              <th scope="col">DT done</th>
              <th scope="col">ICT %</th>
              <th scope="col">CRA %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expandable = row.provinces.length > 0
              const isOpen = open.has(row.name)
              return (
                <Fragment key={row.name}>
                  <tr
                    id={`cov-region-${row.name}`}
                    className={`cov-region-row ${row.attribution === 'owned' ? '' : 'unowned'}`}
                  >
                    <th scope="row">
                      {expandable ? (
                        <button
                          type="button"
                          className="cov-expand"
                          aria-expanded={isOpen}
                          onClick={() => onToggle(row.name)}
                        >
                          {isOpen ? (
                            <ChevronDown size={14} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={14} aria-hidden="true" />
                          )}
                          {row.name}
                        </button>
                      ) : (
                        <span className="cov-expand static">{row.name}</span>
                      )}
                      {ATTRIBUTION_NOTES[row.attribution] && (
                        <span className="kpi-region">{ATTRIBUTION_NOTES[row.attribution]}</span>
                      )}
                    </th>
                    <td>{row.provinces.length || '—'}</td>
                    <td>{fmtCount(row.ict.reached)}</td>
                    <td>{onePct(approvalRate(row.ict))}</td>
                    <td>
                      <BandPill figures={row.cra} />
                    </td>
                  </tr>
                  {isOpen &&
                    row.provinces
                      .map((key) => byKey.get(key))
                      .filter(Boolean)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((member) => (
                        <tr key={member.key} className="cov-member-row">
                          <th scope="row">{member.name}</th>
                          <td />
                          <td>{fmtCount(member.ict.reached)}</td>
                          <td>{onePct(approvalRate(member.ict))}</td>
                          <td>
                            <BandPill figures={member.cra} />
                          </td>
                        </tr>
                      ))}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">
                {data.scoped ? 'Your total' : `All ${owned.length} regions`}
              </th>
              <td>{provinceCount}</td>
              <td>{fmtCount(data.total.ict.reached)}</td>
              <td>{onePct(approvalRate(data.total.ict))}</td>
              <td>{onePct(approvalRate(data.total.cra))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
