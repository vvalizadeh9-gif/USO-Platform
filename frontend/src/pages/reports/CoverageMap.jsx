import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import ExportNumber from '../../components/ExportNumber'
import Icon from '../../components/Icon'
import { AuthorityChip, Banner, Card, EmptyState, SegmentedControl } from '../../components/ui'
import { fmtCount } from './kpiTheme'
import {
  BANDS,
  MAPS,
  PANEL_GAPS,
  approvalRate,
  bandOf,
  detailBand,
  detailRate,
  onePct,
  regionDrift,
  wholePct,
} from './coverageMap'
import iranMap from './iranMap.json'

/** The loading state: the KPI skeleton (kept here, so this module does not
 * import LifecycleGaps, which imports it). */
function Skeleton() {
  return (
    <div className="kpi-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}

/** How long the old map takes to fade out when the switch changes. */
const LEAVE_MS = 160

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Roles Performance → Map (and Lifecycle Gaps → Coverage map).
 *
 * One map at a time -- ICT approval by province, or CRA approval by CRA
 * region, each authority drawn at the level it works at -- and beside it a
 * detail panel that is empty until a shape is clicked. Both fill the height
 * they are given and the map scales to fit it, so the page never scrolls.
 *
 * Where a village is drawn is decided by its CPM province, the same province
 * every figure is grouped by. The borders are OpenStreetMap's (ODbL, via
 * geoBoundaries), committed as `iranMap.json` by `scripts/build-iran-map.py`
 * and keyed by the Persian province name, so the join with the API is the
 * same string on both sides.
 *
 * The map keeps its own counting: ICT is drive-test-done villages
 * ICT-approved, CRA is ICT-approved villages CRA-approved, over every هدف
 * village. The panel shows delivery (assigned, on air, drive test) and then
 * ICT and CRA counted like the Gaps tab, every figure in sites and villages;
 * its ICT and CRA village counts are exports.
 *
 * Rules: a number on every shape; one fixed six-band scale; low sample is
 * hatched, not coloured. Scope is the server's: a PM sees the country;
 * anyone else sees the map with only their own shapes coloured.
 */
export default function CoverageMap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [map, setMap] = useState('ict')
  const [leaving, setLeaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [band, setBand] = useState(null)
  const leaveTimer = useRef(null)

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
      clearTimeout(leaveTimer.current)
    }
  }, [])

  // Esc clears the selection, wherever focus is.
  useEffect(() => {
    if (!selected) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const byKey = useMemo(
    () => new Map((data?.provinces ?? []).filter((r) => r.key).map((r) => [r.key, r])),
    [data]
  )
  const byRegion = useMemo(() => new Map((data?.regions ?? []).map((r) => [r.name, r])), [data])

  if (error) {
    return (
      <Card>
        <EmptyState title="Nothing to show" hint={error} />
      </Card>
    )
  }
  if (!data) return <Skeleton />

  const current = MAPS.find((item) => item.key === map)
  const row = selected ? (map === 'ict' ? byKey.get(selected) : byRegion.get(selected)) : null
  // The old map fades out, then the new one fades in; the panel clears.
  const switchMap = (next) => {
    if (next === map) return
    setSelected(null)
    clearTimeout(leaveTimer.current)
    if (reducedMotion()) {
      setMap(next)
      return
    }
    setLeaving(true)
    leaveTimer.current = setTimeout(() => {
      setMap(next)
      setLeaving(false)
    }, LEAVE_MS)
  }
  const pick = (id) => setSelected(selected === id ? null : id)

  return (
    <div className="cov">
      <Card className="cov-map-card">
        <div className="cov-map-head">
          <SegmentedControl label="Map" options={MAPS} value={map} onChange={switchMap} />
          <div
            className="cov-scale"
            role="list"
            aria-label="Approval rate bands"
            onMouseLeave={() => setBand(null)}
          >
            {BANDS.map((item, index) => (
              <span
                key={item.label}
                role="listitem"
                className="cov-scale-band"
                style={{ background: item.fill, color: item.ink }}
                onMouseEnter={() => setBand(index)}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>

        <Notes data={data} />

        <figure className={`cov-map ${leaving ? 'is-leaving' : ''}`} data-testid={`cov-map-${map}`}>
          {map === 'ict' ? (
            <MapLayer
              key="ict"
              label="ICT approval by province"
              stretch="ICT"
              shapes={Object.entries(iranMap.provinces).map(([key, shape]) => ({
                id: key,
                name: shape.en,
                ...shape,
                figures: byKey.get(key)?.ict,
              }))}
              picked={selected}
              onPick={pick}
              band={band}
              small
            />
          ) : (
            <MapLayer
              key="cra"
              label="CRA approval by region"
              stretch="CRA"
              shapes={Object.entries(iranMap.regions).map(([name, shape]) => ({
                id: name,
                name,
                ...shape,
                figures: byRegion.get(name)?.cra,
              }))}
              picked={selected}
              onPick={pick}
              band={band}
              region
            />
          )}
        </figure>
      </Card>

      <Card className="cov-panel" aria-label="Detail">
        {row ? (
          <Detail
            key={`${map}:${selected}`}
            row={row}
            map={current}
            threshold={data.low_sample_threshold}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="cov-panel-empty">
            <EmptyState
              title={map === 'ict' ? 'Select a province on the map' : 'Select a CRA region on the map'}
              hint="Its sites and villages (assigned, on air, drive test, ICT and CRA) appear here."
            />
          </div>
        )}
      </Card>
    </div>
  )
}

/** The scope and region-drift notes, when there is something to say. */
function Notes({ data }) {
  const drift = regionDrift(data.provinces, iranMap)
  return (
    <>
      {data.scoped && (
        <Banner tone="info">
          Showing your own scope only — {data.lens_label} <strong>{data.key}</strong>. Grey shapes
          are outside it.
        </Banner>
      )}
      {drift.length > 0 && (
        <Banner tone="warning" data-testid="cov-drift">
          The province mapping has moved {drift.map((d) => `${d.name} to ${d.now}`).join(', ')}. The
          figures follow the mapping; the region borders still show the original grouping (
          {drift.map((d) => `${d.name} in ${d.drawn}`).join(', ')}) until the map asset is rebuilt.
        </Banner>
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------
   The map itself.
   --------------------------------------------------------------------------- */

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

/** The tooltip's lines: name and rate, then villages and sites. */
export function tipLines(name, figures, stretch) {
  if (!figures) return [`${name} — outside your scope`]
  const approved = figures.reached - figures.stopped
  const sites = figures.sites ?? { approved: 0, reached: 0 }
  return [
    `${name} · ${wholePct(approvalRate(figures))} ${stretch} approved`,
    `${fmtCount(approved)} of ${fmtCount(figures.reached)} villages`,
    `${fmtCount(sites.approved)} of ${fmtCount(sites.reached)} sites` +
      (figures.low_sample ? ' · too few to compare' : ''),
  ]
}

/**
 * One map: every shape, then the outline of the selected one, then every
 * label -- in that order, so no neighbouring shape is painted over the
 * outline or a label. The tooltip is positioned in the figure.
 */
function MapLayer({ label, stretch, shapes, picked, onPick, band, small, region }) {
  const chosen = shapes.find((shape) => shape.id === picked)
  const [tip, setTip] = useState(null)
  const bandIndex = (shape) => {
    const b = bandOf(shape.figures)
    return b ? BANDS.indexOf(b) : null
  }
  const lit = (shape) => band != null && bandIndex(shape) === band

  const showTip = (shape, event) => {
    const box = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect()
    if (!box) return
    setTip({ id: shape.id, x: event.clientX - box.left + 16, y: event.clientY - box.top + 16 })
  }
  const tipShape = tip && shapes.find((shape) => shape.id === tip.id)

  const classes = ['cov-svg', chosen && 'has-pick', band != null && 'is-dim'].filter(Boolean).join(' ')
  return (
    <>
      <svg viewBox={iranMap.viewBox} className={classes} role="group" aria-label={label}>
        <Hatch />
        <g className="cov-layer">
          {shapes.map((shape) => (
            <Shape
              key={shape.id}
              shape={shape}
              stretch={stretch}
              selected={shape.id === picked}
              lit={lit(shape)}
              onPick={() => onPick(shape.id)}
              onHover={(event) => showTip(shape, event)}
              onLeave={() => setTip(null)}
              region={region}
            />
          ))}
          {chosen && <path d={chosen.path} className="cov-outline" data-testid="cov-outline" />}
          {shapes.map((shape) => (
            <Label
              key={shape.id}
              shape={shape}
              small={small}
              selected={shape.id === picked}
              lit={lit(shape)}
            />
          ))}
        </g>
      </svg>
      {tipShape && (
        <div className="cov-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true" data-testid="cov-tip">
          {tipLines(tipShape.name, tipShape.figures, stretch).map((line, index) => (
            <span key={line} className={index === 0 ? 'cov-tip-title' : 'cov-tip-line'}>
              {line}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function Shape({ shape, stretch, selected, lit, onPick, onHover, onLeave, region }) {
  const { id, name, path, figures } = shape
  const band = bandOf(figures)
  // Three states: coloured by band; hatched (in scope, not comparable); grey
  // (outside this account's scope -- no figures were sent for it at all).
  const fill = band ? band.fill : figures ? 'url(#cov-hatch)' : 'var(--uep-track)'
  const state = band ? 'coloured' : figures ? 'hatched' : 'outside'
  const classes = ['cov-shape', region && 'is-region', selected && 'is-sel', lit && 'is-hl']
    .filter(Boolean)
    .join(' ')

  return (
    <g
      className={classes}
      data-shape={id}
      data-state={state}
      role="button"
      tabIndex={figures ? 0 : -1}
      aria-label={tipLines(name, figures, stretch).join(', ')}
      aria-pressed={selected}
      onClick={figures ? onPick : undefined}
      onMouseEnter={onHover}
      onMouseMove={onHover}
      onMouseLeave={onLeave}
      onKeyDown={(event) => {
        if (figures && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onPick()
        }
      }}
    >
      <path d={path} fill={fill} fillRule="evenodd" />
    </g>
  )
}

function Label({ shape, small, selected, lit }) {
  const { name, label, figures } = shape
  const band = bandOf(figures)
  const x = labelX(label[0], name, small)
  const classes = [
    'cov-label',
    small && 'small',
    band?.ink === '#FFFFFF' && 'on-dark',
    selected && 'is-sel',
    lit && 'is-hl',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <text
      x={x}
      y={label[1]}
      // A halo in the opposite tone keeps a label readable where it spills
      // past its own shape -- onto a neighbour, or onto the page.
      className={classes}
      style={{ fill: band ? band.ink : 'var(--uep-text)' }}
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

/* ---------------------------------------------------------------------------
   The detail panel: one province (ICT map) or one CRA region (CRA map).
   Delivery, then ICT, then CRA; every figure in sites and villages.
   --------------------------------------------------------------------------- */

function Detail({ row, map, threshold, onClose }) {
  const { detail } = row
  const scope = map.shape === 'province' ? `province:${row.key}` : `region:${row.name}`
  const exportProps = { scope, scopeLabel: row.name }
  const where =
    map.shape === 'province'
      ? row.region && `${row.region} region`
      : `${fmtCount(row.provinces.length)} ${row.provinces.length === 1 ? 'province' : 'provinces'}`

  return (
    <div className="cov-detail" role="region" aria-label={`${row.name} detail`}>
      <header className="cov-detail-head">
        <div className="cov-detail-titles">
          <h3 className="cov-detail-name">{row.name}</h3>
          {where && <p className="cov-detail-sub">{where}</p>}
        </div>
        <button type="button" className="btn cov-close" onClick={onClose} aria-label="Clear selection">
          <Icon name="close" size={16} />
        </button>
      </header>

      <section className="cov-group" aria-label="Delivery">
        <GroupHead>
          <h4>Delivery</h4>
        </GroupHead>
        <Figure label="Total assigned" figure={detail.delivery.assigned} />
        <Figure label="Total on air" figure={detail.delivery.on_air} />
        <Figure label="Total drive test" figure={detail.delivery.dt} />
      </section>

      {['ict', 'cra'].map((stretch) => (
        <Stage
          key={stretch}
          stretch={stretch}
          figures={detail[stretch]}
          threshold={threshold}
          exportProps={exportProps}
        />
      ))}
    </div>
  )
}

function GroupHead({ children }) {
  return (
    <div className="cov-group-head">
      <div className="cov-group-title">{children}</div>
      <span className="cov-col">Sites</span>
      <span className="cov-col">Villages</span>
    </div>
  )
}

/** One row: a label, then sites and villages, right-aligned. */
function Figure({ label, figure, dot, gap, exportProps }) {
  return (
    <div className="cov-fig">
      <span className="cov-fig-label">
        {dot && <span className={`cov-dot is-${dot}`} aria-hidden="true" />}
        {label}
      </span>
      <span className="cov-fig-num">{fmtCount(figure.sites)}</span>
      <span className="cov-fig-num">
        {gap ? <ExportNumber value={figure.villages} gap={gap} {...exportProps} /> : fmtCount(figure.villages)}
      </span>
    </div>
  )
}

/** ICT or CRA: the rate pill, approved and pending, and the split bar. */
function Stage({ stretch, figures, threshold, exportProps }) {
  const authority = stretch.toUpperCase()
  const { approved, pending } = figures
  const base = approved.villages + pending.villages
  const share = (n) => (base ? `${(n * 100) / base}%` : '0%')
  return (
    <section className="cov-group" aria-label={authority}>
      <GroupHead>
        <AuthorityChip authority={authority} />
        <RatePill figures={figures} threshold={threshold} />
      </GroupHead>
      <Figure
        label="Approved"
        dot="approved"
        figure={approved}
        gap={PANEL_GAPS[stretch].approved}
        exportProps={exportProps}
      />
      <Figure
        label="Pending"
        dot="pending"
        figure={pending}
        gap={PANEL_GAPS[stretch].pending}
        exportProps={exportProps}
      />
      <div className="cov-split" aria-hidden="true">
        <span className="cov-split-approved" style={{ width: share(approved.villages) }} />
        <span className="cov-split-pending" style={{ width: share(pending.villages) }} />
      </div>
    </section>
  )
}

/** The approval rate on its band's colour, or "Not compared" (low sample). */
function RatePill({ figures, threshold }) {
  const band = detailBand(figures, threshold)
  if (!band) return <span className="cov-pill plain">Not compared</span>
  return (
    <span className="cov-pill" style={{ background: band.fill, color: band.ink }}>
      {onePct(detailRate(figures))}
    </span>
  )
}
