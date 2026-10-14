import { useId, useState } from 'react'
import { SegmentedControl } from '../../components/ui'
import { toPersianDigits } from '../../lib/persianDigits'
import { FIRST_SHAMSI_YEAR, shamsiMonthName } from '../../lib/shamsi'
import { contractorsOf, historyTable } from './history'
import { TabState } from './parts'
import { PIP_STREAMS, STREAM_LIST } from './streams'
import useOverview from './useOverview'
import { formatNumber } from '../../lib/numbers'

const STREAM_OPTIONS = STREAM_LIST.map((s) => ({ key: s.key, label: s.title }))
const RESULT = { met: 'Met plan', near: 'Near plan', below: 'Below 80%', running: 'Running' }

const fmt = (v) => formatNumber(v)
const pct = (v) => (v == null ? '—' : `${v}%`)

/**
 * History: plan against delivered, month by month, for any year.
 *
 * One read per year (GET /pip/overview?period=year, each stream's
 * `months[]`); the contractor and stream are views of it. Every contractor
 * shows the Internal PIP beside the contractors' plans; one contractor never
 * does (the Internal PIP is a total target, not anyone's own).
 */
export default function HistoryTab({ runningYear }) {
  const ids = { year: useId(), contractor: useId() }
  const [year, setYear] = useState(runningYear)
  const [contractor, setContractor] = useState('all')
  const [streamKey, setStreamKey] = useState(PIP_STREAMS.dt.key)
  const overview = useOverview({ params: { period: 'year', year, month: 1 }, enabled: Boolean(year) })

  const years = []
  for (let y = runningYear; y >= FIRST_SHAMSI_YEAR; y -= 1) years.push(y)

  const months = overview.data?.[streamKey]?.months ?? null
  const people = contractorsOf(months)
  const chosen = contractor === 'all' ? null : Number(contractor)
  // A contractor missing from the year read reads as every contractor.
  const contractorId = chosen != null && people.some((p) => p.id === chosen) ? chosen : null
  const all = contractorId == null
  const streamTitle = STREAM_LIST.find((s) => s.key === streamKey).title

  return (
    <div className="mp-history">
      <div className="mp-history-controls">
        <label className="sr-only" htmlFor={ids.year}>Year</label>
        <select
          id={ids.year}
          className="mp-select mp-fa"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>{toPersianDigits(y)}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={ids.contractor}>Contractor</label>
        <select
          id={ids.contractor}
          className="mp-select"
          value={all ? 'all' : String(contractorId)}
          onChange={(e) => setContractor(e.target.value)}
        >
          <option value="all">All contractors</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <SegmentedControl options={STREAM_OPTIONS} value={streamKey} onChange={setStreamKey} label="Stream" />
      </div>

      {overview.state !== 'ready' || !months ? (
        <TabState state={overview.state === 'ready' ? 'failed' : overview.state} what="History" onRetry={overview.reload} />
      ) : (
        <HistoryTable
          table={historyTable(months, contractorId)}
          all={all}
          caption={`${streamTitle} plan against delivered by month, ${year}${all ? '' : `, ${people.find((p) => p.id === contractorId)?.name}`}`}
        />
      )}
    </div>
  )
}

function HistoryTable({ table, all, caption }) {
  const span = all ? 6 : 4
  return (
    <div className="mp-table-wrap">
      <table className="mp-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="mp-th-start">Month</th>
            <th scope="col">Contractor plan</th>
            {all && <th scope="col">Internal PIP</th>}
            <th scope="col">Delivered</th>
            <th scope="col">% of plan</th>
            {all && <th scope="col">% of Internal PIP</th>}
            <th scope="col" className="mp-th-start">Result</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) =>
            r.future ? (
              <tr key={r.month} className="mp-future">
                <th scope="row" className="mp-fa">{shamsiMonthName(r.month)}</th>
                <td colSpan={span} className="mp-th-start">—</td>
              </tr>
            ) : (
              <tr key={r.month} data-running={r.running || undefined}>
                <th scope="row" className="mp-fa">{shamsiMonthName(r.month)}</th>
                <td>{fmt(r.plan)}</td>
                {all && <td>{fmt(r.internal)}</td>}
                <td className="mp-strong">{fmt(r.delivered)}</td>
                <td>{pct(r.pctPlan)}</td>
                {all && <td>{pct(r.pctInternal)}</td>}
                <td className="mp-th-start">
                  {r.result ? (
                    <span className="mp-result" data-result={r.result}>
                      <span className="mp-status-mark" aria-hidden="true" />
                      {RESULT[r.result]}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Completed months</th>
            <td>{fmt(table.totals.plan)}</td>
            {all && <td>{fmt(table.totals.internal)}</td>}
            <td>{fmt(table.totals.delivered)}</td>
            <td>{pct(table.totals.pctPlan)}</td>
            {all && <td>{pct(table.totals.pctInternal)}</td>}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
