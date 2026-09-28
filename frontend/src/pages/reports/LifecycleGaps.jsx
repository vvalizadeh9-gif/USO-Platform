import { useEffect, useState } from 'react'
import { AlertTriangle, Layers, X } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
  Banner,
  Card,
  EmptyState,
  PageHead,
  SegmentedControl,
  Tabs,
} from '../../components/ui'
import CoverageMap from './CoverageMap'
import {
  ATTRIBUTION_NOTES,
  BLOCKS,
  GAPS,
  LENSES,
  chartMax,
  checksum,
  columnCaption,
  dataNotes,
  fmt,
  hasData,
  heightPct,
  mojriStamp,
  panelRows,
  summaryLine,
} from './lifecycleGaps'

/**
 * Performance → Lifecycle Gaps.
 *
 * The Gaps tab answers one question in one look, with no scrolling: how big
 * is each gap? Six columns in three blocks -- pending approval, one approved
 * and the other remained, and approved villages missing from Mojri's tracker
 * -- all on one baseline and one scale, so the tallest solid column is the
 * biggest gap on the page. Who is behind a gap comes only on click, in a
 * panel docked beside the chart.
 *
 * Rules rather than choices:
 *
 * **ICT left, CRA right, in every block**, each in its authority colour and
 * always with its label. Cobalt is never a data colour here: it marks the
 * selected column only.
 *
 * **The panel adds up, visibly.** Its footer sums the rows it received and
 * says out loud whether they make the gap's total.
 *
 * **The lens is PM's.** Every other role is confined by the server to its own
 * villages, so the panel shows their own row and no lens tabs.
 *
 * Hand-built HTML columns. No charting library, deliberately.
 */
export default function LifecycleGaps() {
  const { user } = useAuth()
  const isPm = user?.role?.name === 'PM'

  const [lens, setLens] = useState(null)
  const [tab, setTab] = useState('gaps')
  const [selected, setSelected] = useState(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // Which lens this account may ask for. PM chooses; every other role is told
  // by the server, through the same endpoint the KPI page asks -- one scope
  // rule, one answer, rather than a role list in the browser.
  useEffect(() => {
    let live = true
    api
      .get('/kpi/lenses')
      .then((r) => live && setLens(r.data.selectable ? 'province' : r.data.lens))
      .catch((err) => live && setError(readError(err, 'Could not work out your scope.')))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!lens) return undefined
    let live = true
    setError('')
    api
      .get('/gaps/overview', { params: { lens } })
      .then((r) => live && setData(r.data))
      .catch((err) => live && setError(readError(err, 'Could not load the gaps.')))
    return () => {
      live = false
    }
  }, [lens])

  // Esc closes the panel, wherever focus is.
  useEffect(() => {
    if (!selected) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const notes = dataNotes(data?.data_quality)

  if (error && !data) {
    return (
      <>
        <PageHead eyebrow="Performance" title="Lifecycle Gaps" />
        <Card>
          <EmptyState title="Nothing to show" hint={error} />
        </Card>
      </>
    )
  }

  return (
    <div className="gap-page">
      <PageHead
        eyebrow="Performance"
        title="Lifecycle Gaps"
        actions={
          notes.length > 0 && (
            <button
              type="button"
              className="gap-note-btn"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              {notes.length} data {notes.length === 1 ? 'note' : 'notes'}
            </button>
          )
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Gap views" className="gap-tabs" />

      {notesOpen && notes.length > 0 && (
        <Banner tone="warning" title="Data quality.">
          {notes.map((note) => (
            <span key={note}>{note} </span>
          ))}
        </Banner>
      )}
      {error && data && <Banner tone="error">{error}</Banner>}

      {tab === 'map' ? (
        <CoverageMap />
      ) : !data ? (
        <Skeleton />
      ) : (
        <Card
          icon={Layers}
          title="Where villages are stuck"
          className="gap-card"
          actions={
            <div className="gap-total">
              <span className="gap-total-figure">{fmt(data.totals.eligible)}</span>
              <span className="gap-total-caption">villages with drive test done</span>
            </div>
          }
        >
          <div className="gap-body">
            <Chart
              data={data}
              selected={selected}
              onSelect={(key) => setSelected((current) => (current === key ? null : key))}
            />
            {selected && (
              <Panel
                gapKey={selected}
                data={data}
                isPm={isPm}
                onLens={setLens}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

const TABS = [
  { key: 'gaps', label: 'Gaps' },
  { key: 'map', label: 'Coverage map' },
]

function readError(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/* ---------------------------------------------------------------------------
   The chart: three blocks, two columns each, one baseline and one scale.
   --------------------------------------------------------------------------- */

function Chart({ data, selected, onSelect }) {
  const max = chartMax(data)
  return (
    <div className="gap-chart">
      <div className="gap-blocks">
        {BLOCKS.map((block) => (
          <section key={block.key} className="gap-block" aria-labelledby={`gap-block-${block.key}`}>
            <h3 id={`gap-block-${block.key}`} className="gap-block-title">
              {block.title}
            </h3>
            <div className="gap-cols">
              {block.gaps.map((key) => (
                <Column
                  key={key}
                  gapKey={key}
                  data={data}
                  max={max}
                  selected={selected === key}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="gap-legend">
        <span><i className="gap-swatch" data-authority="ict" aria-hidden="true" />ICT</span>
        <span><i className="gap-swatch" data-authority="cra" aria-hidden="true" />CRA</span>
        <span>
          <i className="gap-swatch gap-swatch-base" aria-hidden="true" />
          faint = the base it is counted from
        </span>
        <span>All six columns share one baseline and one scale.</span>
      </p>
    </div>
  )
}

function Column({ gapKey, data, max, selected, onSelect }) {
  const meta = GAPS[gapKey]
  const gap = data.gaps[gapKey]
  const ready = hasData(gapKey, data)
  const authority = meta.authority.toLowerCase()

  return (
    <button
      type="button"
      className="gap-col"
      data-authority={authority}
      aria-pressed={selected}
      aria-label={
        ready
          ? `${meta.authority} ${meta.label}: ${fmt(gap.count)} villages`
          : `${meta.authority} ${meta.label}: no Mojri import yet`
      }
      disabled={!ready}
      onClick={() => onSelect(gapKey)}
    >
      <span className="gap-col-figure">{ready ? fmt(gap.count) : '—'}</span>
      <span className="gap-col-caption">{columnCaption(gapKey, data)}</span>
      <span className="gap-col-plot" aria-hidden="true">
        {ready && meta.showBase && (
          <span className="gap-col-base" style={{ height: `${heightPct(gap.base, max)}%` }} />
        )}
        {ready && (
          <span className="gap-col-bar" style={{ height: `${heightPct(gap.count, max)}%` }} />
        )}
      </span>
      <span className="gap-col-foot">
        <span className="gap-chip" data-authority={authority}>
          {meta.authority}
        </span>
        <span className="gap-col-label">{meta.label}</span>
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------------------
   The details panel: who is behind the selected gap.
   --------------------------------------------------------------------------- */

function Panel({ gapKey, data, isPm, onLens, onClose }) {
  const meta = GAPS[gapKey]
  const total = data.gaps[gapKey].count
  const rows = data.rows[gapKey] ?? []
  const { shown, more } = panelRows(rows, total)
  const widest = Math.max(0, ...shown.map((row) => row.count), more?.count ?? 0)
  const block = BLOCKS.find((item) => item.key === meta.block)
  const check = checksum(rows, total, data.lens)

  return (
    <aside className="gap-panel" aria-label={`Details: ${meta.title}`}>
      <header className="gap-panel-head">
        <div>
          <div className="gap-panel-caption">{block.title}</div>
          <h3 className="gap-panel-title">{meta.title}</h3>
          <p className="gap-panel-summary">{summaryLine(gapKey, data)}</p>
          {meta.mojri && (
            <p className="gap-panel-summary">{mojriStamp(data.last_mojri_import)}</p>
          )}
        </div>
        <button
          type="button"
          className="btn gap-panel-close"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {isPm && (
        <SegmentedControl
          label="Lens"
          options={LENSES}
          value={data.lens}
          onChange={onLens}
          className="gap-panel-lenses"
        />
      )}

      <ul className="gap-rows" data-authority={meta.authority.toLowerCase()}>
        {shown.map((row) => (
          <Row key={row.name} row={row} widest={widest} />
        ))}
        {more && <Row row={more} widest={widest} />}
      </ul>

      <p className={`gap-checksum ${check.ok ? '' : 'bad'}`} data-testid="gap-checksum">
        {check.ok ? null : <AlertTriangle size={15} aria-hidden="true" />}
        <span>{check.text}</span>
        {check.ok && <span aria-label="adds up"> ✓</span>}
      </p>
    </aside>
  )
}

function Row({ row, widest }) {
  const note = ATTRIBUTION_NOTES[row.attribution]
  const owned = row.attribution === 'owned'
  return (
    <li className={`gap-row ${row.attribution === 'more' ? 'gap-row-more' : ''}`}>
      <div className="gap-row-main">
        <span
          className={`gap-row-name ${owned ? 'gap-farsi' : ''}`}
          dir={owned ? 'auto' : undefined}
          title={note}
        >
          {row.name}
        </span>
        <span className="gap-row-bar" aria-hidden="true">
          <span
            className="gap-row-fill"
            style={{ width: `${widest ? (row.count * 100) / widest : 0}%` }}
          />
        </span>
        <span className="gap-row-rate">
          own rate {row.rate == null ? '—' : `${Math.round(row.rate)}%`} · {fmt(row.count)} of{' '}
          {fmt(row.base)}
        </span>
      </div>
      <div className="gap-row-figures">
        <span className="gap-row-count">{fmt(row.count)}</span>
        <span className="gap-row-share">
          {row.share == null ? '—' : `${row.share.toFixed(1)}%`} of gap
        </span>
      </div>
    </li>
  )
}

export function Skeleton() {
  return (
    <div className="kpi-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
