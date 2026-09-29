import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import ExportNumber from '../../components/ExportNumber'
import { AuthorityChip, Banner, Card, EmptyState, SegmentedControl } from '../../components/ui'
import { fmtCount } from './kpiTheme'
import { ATTRIBUTION_NOTES } from './lifecycleGaps'
import {
  BANDS,
  DETAIL_LENSES,
  MAPS,
  REMAINED_NOTES,
  approvalRate,
  bandOf,
  detailBand,
  detailRate,
  detailRows,
  onePct,
  regionDrift,
  wholePct,
} from './coverageMap'
import iranMap from './iranMap.json'
import { Skeleton } from './LifecycleGaps'

/**
 * Lifecycle Gaps → Coverage map.
 *
 * One map at a time -- ICT approval by province, or CRA approval by CRA
 * region, each authority drawn at the level it works at -- and beside it a
 * detail panel that is empty until a shape is clicked.
 *
 * Where a village is drawn is decided by its CPM province, the same province
 * every figure is grouped by. The borders are OpenStreetMap's, committed as
 * `iranMap.json` by `scripts/build-iran-map.py` and keyed by the Persian
 * province name, so the join with the API is the same string on both sides.
 *
 * The map keeps its own counting, unchanged: ICT is drive-test-done villages
 * ICT-approved, CRA is ICT-approved villages CRA-approved, over every هدف
 * village. The detail panel counts like the Gaps tab -- on-air, drive-tested
 * villages -- because every count in it is an export, and an export lists
 * exactly the villages the Gaps tab counts.
 *
 * Rules: a number on every shape; one fixed six-band scale; low sample is
 * hatched, not coloured. Scope is the server's: a PM sees the country;
 * anyone else sees the map with only their own shapes coloured.
 */
export default function CoverageMap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [map, setMap] = useState('ict')
  const [selected, setSelected] = useState(null)

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
  const switchMap = (next) => {
    setMap(next)
    setSelected(null)
  }

  return (
    <div className="cov">
      <Card className="cov-map-card">
        <div className="cov-map-head">
          <SegmentedControl label="Map" options={MAPS} value={map} onChange={switchMap} />
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
        </div>

        <Notes data={data} />

        <figure className="cov-map" data-testid={`cov-map-${map}`}>
          {map === 'ict' ? (
            <MapLayer
              label="ICT approval by province"
              stretch="ICT"
              shapes={Object.entries(iranMap.provinces).map(([key, shape]) => ({
                id: key,
                name: shape.en,
                ...shape,
                figures: byKey.get(key)?.ict,
              }))}
              picked={selected}
              onPick={(key) => setSelected(selected === key ? null : key)}
              small
            />
          ) : (
            <MapLayer
              label="CRA approval by region"
              stretch="CRA"
              shapes={Object.entries(iranMap.regions).map(([name, shape]) => ({
                id: name,
                name,
                ...shape,
                figures: byRegion.get(name)?.cra,
              }))}
              picked={selected}
              onPick={(name) => setSelected(selected === name ? null : name)}
              region
            />
          )}
        </figure>

        <p className="cov-caption">
          {map === 'ict'
            ? 'Share of drive-test-done villages ICT-approved.'
            : 'Share of ICT-approved villages CRA-approved.'}{' '}
          Hatched = fewer than {data.low_sample_threshold} reached, not compared. Boundaries ©
          OpenStreetMap contributors (ODbL), via geoBoundaries.
        </p>
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
              hint="Its approval, pending and remained villages appear here, and who holds them."
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
   The map itself: unchanged apart from a single selection.
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
 * One map: every shape, then the outline of the selected one, then every
 * label -- in that order, so no neighbouring shape is painted over the
 * outline or a label.
 */
function MapLayer({ label, stretch, shapes, picked, onPick, small, region }) {
  const chosen = shapes.find((shape) => shape.id === picked)
  return (
    <svg viewBox={iranMap.viewBox} role="group" aria-label={label}>
      <Hatch />
      {shapes.map((shape) => (
        <Shape
          key={shape.id}
          shape={shape}
          stretch={stretch}
          selected={shape.id === picked}
          onPick={() => onPick(shape.id)}
          region={region}
        />
      ))}
      {chosen && <path d={chosen.path} className="cov-outline" data-testid="cov-outline" />}
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
  const fill = band ? band.fill : figures ? 'url(#cov-hatch)' : 'var(--track)'
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

/* ---------------------------------------------------------------------------
   The detail panel: one province (ICT map) or one CRA region (CRA map).
   --------------------------------------------------------------------------- */

function Detail({ row, map, threshold, onClose }) {
  const stretch = map.key
  const lenses = DETAIL_LENSES[stretch]
  const [lens, setLens] = useState(lenses[0].key)
  const figures = row.detail[stretch]
  const scope = map.shape === 'province' ? `province:${row.key}` : `region:${row.name}`
  const gapOf = { approved: `${stretch}_approved`, pending: `pending_${stretch}`, remained: `${stretch}_remained` }
  const exportProps = { scope, scopeLabel: row.name }
  const rows = detailRows(row.detail, stretch, lens)
  const where =
    map.shape === 'province'
      ? row.region && `${row.region} region`
      : `${row.provinces.length} ${row.provinces.length === 1 ? 'province' : 'provinces'}`
  const managers = row.managers?.length ? `RM ${row.managers.join(', ')}` : null
  const attributionNote = ATTRIBUTION_NOTES[row.attribution]

  return (
    <div className="cov-detail" role="region" aria-label={`${row.name} detail`}>
      <header className="cov-detail-head">
        <div className="cov-detail-titles">
          <h3 className="cov-detail-name">{row.name}</h3>
          <p className="cov-detail-sub">
            {[where, managers, attributionNote].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" className="btn cov-close" onClick={onClose} aria-label="Clear selection">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <dl className="cov-figures">
        <div className="cov-figure cov-figure-wide">
          <dt>
            <AuthorityChip authority={map.authority} /> approved
          </dt>
          <dd>
            <span className="cov-figure-main">{onePct(detailRate(figures))}</span>
            <BandPill figures={figures} threshold={threshold} band />
          </dd>
          <dd className="cov-figure-note">
            <ExportNumber value={figures.approved} gap={gapOf.approved} {...exportProps} /> of{' '}
            {fmtCount(figures.base)} drive-tested
          </dd>
        </div>
        <div className="cov-figure">
          <dt>Pending</dt>
          <dd className="cov-figure-main">
            <ExportNumber value={figures.pending} gap={gapOf.pending} {...exportProps} />
          </dd>
        </div>
        <div className="cov-figure">
          <dt>Remained</dt>
          <dd className="cov-figure-main">
            <ExportNumber value={figures.remained} gap={gapOf.remained} {...exportProps} />
          </dd>
          <dd className="cov-figure-note">{REMAINED_NOTES[stretch]}</dd>
        </div>
      </dl>
      {figures.base > 0 && figures.base < threshold && (
        <p className="cov-low">
          Fewer than {threshold} drive-tested villages, so this is not compared.
        </p>
      )}

      <SegmentedControl
        label="List by"
        options={lenses}
        value={lens}
        onChange={setLens}
        className="cov-detail-lenses"
      />
      <ul className="cov-rows" aria-label={`Pending by ${lenses.find((l) => l.key === lens).label}`}>
        {rows.map((item) => (
          <li key={`${item.attribution}:${item.name}`} className="cov-row">
            <span
              className={`cov-row-name ${item.attribution === 'owned' ? 'text-farsi' : 'is-unowned'}`}
              dir={item.attribution === 'owned' ? 'auto' : undefined}
              title={ATTRIBUTION_NOTES[item.attribution]}
            >
              {item.name}
            </span>
            {stretch === 'cra' && lens === 'province' && (
              <BandPill figures={item.figures} threshold={threshold} />
            )}
            <span className="cov-row-count">
              <ExportNumber
                value={item.pending}
                gap={gapOf.pending}
                lens={lens}
                keyValue={item.name}
                {...exportProps}
              />
            </span>
            <span className="cov-row-of">
              of {fmtCount(item.base)} · {item.pendingShare == null ? '—' : `${Math.round(item.pendingShare)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * An approval rate on its band's colour, or plain when not compared. With
 * `band`, the pill names the band ("85%+") -- for when the rate itself is
 * already printed beside it.
 */
function BandPill({ figures, threshold, band: showBand = false }) {
  const band = detailBand(figures, threshold)
  const rate = detailRate(figures)
  if (!band) {
    return <span className="cov-pill plain">{showBand ? 'Not compared' : onePct(rate)}</span>
  }
  return (
    <span className="cov-pill" style={{ background: band.fill, color: band.ink }}>
      {showBand ? band.label : onePct(rate)}
    </span>
  )
}
