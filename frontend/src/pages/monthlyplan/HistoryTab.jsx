import { useEffect, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { SegmentedControl } from '../../components/ui'
import { toPersianDigits } from '../../lib/persianDigits'
import { shamsiMonthName } from '../../lib/shamsi'
import { BandSkeleton } from './DecisionBand'
import { BEHIND_PERCENT, contractorYear, signedNumber, worstFirst } from './history'
import MeasureList, { ListSkeleton } from './MeasureList'
import { TabState } from './parts'
import { BAND_STREAMS, BAND_TITLE, initials } from './planBoard'
import { PIP_STREAMS } from './streams'
import StripRows from './StripRows'
import TrendChart from './TrendChart'
import useOverview from './useOverview'

const VIEWS = [
  { key: 'trend', label: 'Trend' },
  { key: 'table', label: 'Table' },
]
const pct = (v) => (v == null ? '—' : `${v}%`)

/**
 * The scorecard's DT assignment per contractor and month (`available`: sites
 * held), keyed `{ [contractorId]: { [month]: number } }`. The scorecard is
 * DT only; Acceptance has no assignment. A failed read leaves the Assigned
 * row blank rather than the page empty.
 */
function useAssigned(year, reloadKey) {
  const [state, setState] = useState({ year: null, byContractor: {} })
  useEffect(() => {
    let live = true
    api
      .get('/pip/scorecard', { params: { year } })
      .then((r) => {
        if (!live) return
        const byContractor = {}
        for (const m of r.data.months ?? []) {
          for (const row of m.rows ?? []) {
            ;(byContractor[row.contractor_id] ??= {})[m.shamsi_month] = row.available
          }
        }
        setState({ year, byContractor })
      })
      .catch(() => live && setState({ year, byContractor: {} }))
    return () => {
      live = false
    }
  }, [year, reloadKey])
  return state.year === year ? state.byContractor : {}
}

/**
 * History: each contractor's PIP, actual delivery and assignment across one
 * Shamsi year, DT delivery and Acceptance stacked, as a Trend or a Table.
 *
 * The year is read once (GET /pip/overview?period=year, each stream's
 * `months[]`) plus the scorecard for the DT assignment. The left list is every
 * contractor, worst first.
 */
export default function HistoryTab({ year }) {
  const overview = useOverview({ params: { period: 'year', year, month: 1 }, enabled: Boolean(year) })
  const assigned = useAssigned(year, overview.data)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('trend')

  if (overview.state === 'loading') {
    return (
      <div className="mp2-page" role="status" aria-label="Loading the history">
        <div className="mp2-split mp2-split-full">
          <ListSkeleton />
          <section className="mp2-card mp2-detail"><BandSkeleton /></section>
        </div>
      </div>
    )
  }
  const streams = { dt: overview.data?.dt?.months ?? null, acceptance: overview.data?.acceptance?.months ?? null }
  if (overview.state !== 'ready' || !streams.dt) {
    return overview.state === 'denied' ? (
      <TabState state="denied" what="History" />
    ) : (
      <div className="mp2-state" role="alert">
        Couldn’t load the history
        <button type="button" className="mp-btn" onClick={overview.reload}>
          <Icon name="renew" size={16} /> Try again
        </button>
      </div>
    )
  }

  const people = worstFirst(streams)
  if (people.length === 0) return <div className="mp2-state">No contractors yet</div>
  const selected = people.find((p) => p.id === selectedId) ?? people[0]

  const figure = (p, key) => {
    const v = p.pct[key]
    return { key, value: pct(v), tone: v != null && v < BEHIND_PERCENT ? 'danger' : undefined }
  }
  const groups = [
    {
      key: 'worst',
      title: 'Worst first',
      icon: 'chart--column',
      rows: people.map((p) => ({ key: String(p.id), name: p.name, figures: [figure(p, 'dt'), figure(p, 'acceptance')] })),
    },
  ]

  return (
    <div className="mp2-page">
      <div className="mp2-split mp2-split-full">
        <MeasureList
          label="Contractors"
          groups={groups}
          value={String(selected.id)}
          onChange={(key) => setSelectedId(Number(key))}
          columns={{ group: 'worst', labels: ['DT', 'Acc'] }}
        />
        <section className="mp2-card mp2-detail" aria-label={selected.name} key={selected.id}>
          <header className="mp2-detail-head">
            <span className="mp2-avatar mp-fa" aria-hidden="true">{initials(selected.name)}</span>
            <div className="mp2-detail-who">
              <h2 className="mp-fa">{selected.name}</h2>
              <p>Delivered of PIP</p>
            </div>
            <SegmentedControl options={VIEWS} value={view} onChange={setView} label="View" className="mp2-seg" />
          </header>
          <div className="mp2-bands">
            {BAND_STREAMS.map((stream) => {
              const key = stream === 'DT' ? 'dt' : 'acceptance'
              const data = contractorYear(streams[key], selected.id, stream === 'DT' ? (assigned[selected.id] ?? {}) : null)
              return <HistoryBand key={stream} stream={stream} data={data} view={view} year={year} name={selected.name} hasAssignment={PIP_STREAMS[key].hasAssignment} />
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function HistoryBand({ stream, data, view, year, name, hasAssignment }) {
  const title = BAND_TITLE[stream]
  const label = `${title}, ${name}, ${toPersianDigits(year)}: PIP against actual by month. ${data.rows
    .filter((r) => !r.future)
    .map((r) => `${shamsiMonthName(r.month)} ${r.actual ?? 0} of ${r.pip ?? 'no plan'}`)
    .join('; ')}`
  return (
    <section className="mp2-band mp2-band-history" aria-label={title}>
      <div className="mp2-history-head">
        <h2>{title}</h2>
        <span className="mp2-percent tnum" data-tone={data.total.pct != null && data.total.pct < BEHIND_PERCENT ? 'danger' : undefined}>
          {pct(data.total.pct)}
        </span>
        <span className="mp2-of">of PIP</span>
        <span className="mp2-legend" aria-hidden="true">
          <span><i className="mp2-key-pip" /> PIP</span>
          <span><i className="mp2-key-actual" /> Actual</span>
          <span><i className="mp2-key-capsule" /> Running month</span>
        </span>
      </div>
      {view === 'trend' ? (
        <>
          <TrendChart rows={data.rows} label={label} />
          <StripRows rows={data.rows} />
        </>
      ) : (
        <MonthTable data={data} title={title} hasAssignment={hasAssignment} />
      )}
    </section>
  )
}

/** The accessible twin of the chart: twelve months and a pinned Total. */
function MonthTable({ data, title, hasAssignment }) {
  const { rows, total } = data
  const rowsDef = [
    hasAssignment && { key: 'assigned', label: 'Assigned', cell: (r) => r.assigned, total: () => '' },
    { key: 'pip', label: 'PIP', cell: (r) => r.pip, total: () => total.pip },
    { key: 'actual', label: 'Actual', cell: (r) => r.actual, total: () => total.actual },
    { key: 'gap', label: 'Gap', cell: (r) => (r.gap == null ? null : signedNumber(r.gap)), total: () => (total.gap == null ? null : signedNumber(total.gap)), tone: (v) => (String(v).startsWith('−') ? 'danger' : undefined) },
    { key: 'pct', label: '%', cell: (r) => (r.pct == null ? null : `${r.pct}%`), total: () => (total.pct == null ? null : `${total.pct}%`), tone: (v) => (v != null && parseInt(v, 10) < BEHIND_PERCENT ? 'danger' : undefined) },
  ].filter(Boolean)
  return (
    <div className="mp2-table-wrap">
      <table className="mp2-table">
        <caption className="sr-only">{title} by month</caption>
        <thead>
          <tr>
            <th scope="col" />
            {rows.map((r) => (
              <th key={r.month} scope="col" className="mp-fa" data-running={r.running || undefined}>
                {shamsiMonthName(r.month)}
              </th>
            ))}
            <th scope="col" className="mp2-total-col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowsDef.map((def) => (
            <tr key={def.key}>
              <th scope="row">{def.label}</th>
              {rows.map((r) => {
                const v = def.cell(r)
                // A month ahead is empty, and a month still running is never judged.
                const blank = v == null || (r.future && def.key !== 'pip') || (r.running && (def.key === 'gap' || def.key === 'pct'))
                return (
                  <td key={r.month} className="tnum" data-tone={blank ? undefined : def.tone?.(v)}>
                    {blank ? '' : v}
                  </td>
                )
              })}
              <td className="tnum mp2-total-col" data-tone={def.tone?.(def.total())}>
                {def.total() ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
