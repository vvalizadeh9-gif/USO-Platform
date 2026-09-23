import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Info, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { EmptyState, PageHead } from '../../components/ui'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import {
  FUNNEL_STEPS,
  HEATMAP_COLUMNS,
  LENSES,
  SHADES,
  cellShade,
  deltaTone,
  fmtCount,
  fmtDelta,
  fmtPct,
  importStamp,
  lensLabel,
} from './kpiTheme'

/**
 * Reports → KPI & Performance.
 *
 * Delivery and acceptance progress for one owner — a regional manager, a PSO
 * coordinator, a contractor or a CRA region — always beside the country
 * average, which is weighted and is computed over all 31 provinces whatever
 * the reader can see.
 *
 * Three things about this page are rules rather than choices, and they are
 * enforced on the server as well:
 *
 * Nothing here ranks people. The heatmap ranks provinces inside one owner's
 * scope; there is no table of managers against each other, and no lens shows
 * a second person's figure next to the first.
 *
 * A province with fewer than ten DT-done villages is shown but not compared.
 * Its cells are grey and read "not compared", it takes no colour, and it sorts
 * last however good its percentage looks.
 *
 * On air and DT done are measured against the scope; ICT and CRA approval are
 * measured against DT-done villages. The two bases are different on purpose,
 * and each bar says which one it used.
 *
 * The lens row is PM's. Every other role gets its own scope forced by the
 * server, so this page shows them a fixed chip rather than a control that
 * would answer 403.
 */
export default function KpiPerformance() {
  const { user } = useAuth()
  const role = user?.role?.name

  const [lens, setLens] = useState(null)
  const [key, setKey] = useState(null)
  const [options, setOptions] = useState(null)
  const [data, setData] = useState(null)
  const [contractors, setContractors] = useState(null)
  const [mode, setMode] = useState('ict')
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')

  const isPm = role === 'PM'

  // What this account may point the page at. For PM that is every person
  // behind all four lenses; for everyone else the server answers with their
  // own one, which is also all it will serve.
  useEffect(() => {
    let live = true
    api
      .get('/kpi/lenses')
      .then((r) => {
        if (!live) return
        setOptions(r.data)
        const first = r.data.lens ?? Object.keys(r.data.options)[0]
        setLens((current) => current ?? first)
        setKey((current) => current ?? r.data.key ?? r.data.options[first]?.[0] ?? null)
      })
      .catch((err) => live && setError(readError(err, 'Could not load the lens list.')))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!lens) return undefined
    let live = true
    setError('')
    setData(null)
    api
      .get('/kpi/summary', { params: clean({ lens, key }) })
      .then((r) => live && setData(r.data))
      .catch((err) => live && setError(readError(err, 'Could not load KPI data.')))
    return () => {
      live = false
    }
  }, [lens, key])

  // The contractors section exists under the coordinator lens only, and only
  // for the two roles allowed to see it. Asking for it anywhere else would be
  // a 403, so the page does not ask.
  const wantsContractors =
    data?.lens === 'coordinator' && (isPm || role === 'Coordinator')

  useEffect(() => {
    if (!wantsContractors) {
      setContractors(null)
      return undefined
    }
    let live = true
    api
      .get('/kpi/contractors', { params: clean({ key: data.key, mode }) })
      .then((r) => live && setContractors(r.data))
      .catch(() => live && setContractors(null))
    return () => {
      live = false
    }
  }, [wantsContractors, data?.key, mode])

  const download = useCallback(
    async (format) => {
      setExporting(format)
      setError('')
      try {
        const response = await api.get(`/kpi/export.${format}`, {
          params: clean({ lens, key, mode }),
          responseType: 'blob',
        })
        saveBlob(
          response.data,
          filenameFrom(response.headers, `UEP-KPI.${format}`)
        )
      } catch (err) {
        setError(await describeBlobError(err))
      } finally {
        setExporting('')
      }
    },
    [lens, key, mode]
  )

  const lensKeys = useMemo(
    () => (options?.options?.[lens] ?? []),
    [options, lens]
  )

  if (error && !data) {
    return (
      <>
        <PageHead eyebrow="Reports" title="KPI &amp; Performance" />
        <div className="card card-pad">
          <EmptyState title="Nothing to show" hint={error} />
        </div>
      </>
    )
  }

  return (
    <div className="kpi">
      <PageHead
        eyebrow="Reports"
        title="KPI &amp; Performance"
        subtitle={`Last CPM import · ${importStamp(data?.last_cpm_import)}`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            {isPm && (
              <Link className="btn btn-ghost kpi-round" to="/reports/kpi/mapping">
                <Settings2 size={15} aria-hidden="true" /> Mapping
              </Link>
            )}
            <button
              type="button"
              className="btn btn-ghost kpi-round"
              onClick={() => download('xlsx')}
              disabled={!data || exporting !== ''}
            >
              <FileSpreadsheet size={15} aria-hidden="true" />
              {exporting === 'xlsx' ? 'Building…' : 'Export Excel'}
            </button>
            <button
              type="button"
              className="btn btn-primary kpi-round"
              onClick={() => download('pdf')}
              disabled={!data || exporting !== ''}
            >
              <Download size={15} aria-hidden="true" />
              {exporting === 'pdf' ? 'Building…' : 'Export PDF'}
            </button>
          </div>
        }
      />

      {error && data && <div className="kpi-error">{error}</div>}

      <LensRow
        selectable={isPm}
        lens={lens}
        lensKey={key}
        keys={lensKeys}
        chip={data?.scope?.chip}
        onLens={(next) => {
          setLens(next)
          setKey(options?.options?.[next]?.[0] ?? null)
        }}
        onKey={setKey}
      />

      {role === 'Contractor' && (
        <p className="kpi-banner">
          <Info size={16} aria-hidden="true" />
          Showing only your sites — work items where DT SC in CPM is{' '}
          <strong>{data?.key ?? '…'}</strong>.
        </p>
      )}

      {!data ? (
        <Skeleton />
      ) : (
        <>
          <div className="kpi-funnels">
            <FunnelCard
              title="Work items"
              total={data.work_items.total}
              stages={workItemStages(data)}
            />
            <FunnelCard
              title="Villages"
              total={data.villages.total}
              stages={villageStages(data)}
            />
          </div>

          <Heatmap
            rows={data.provinces}
            countryRow={data.country_row}
            threshold={data.low_sample_threshold}
          />

          {wantsContractors && (
            <Contractors data={contractors} mode={mode} onMode={setMode} />
          )}
        </>
      )}
    </div>
  )
}

function clean(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && value !== '')
  )
}

function readError(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  return fallback
}

/**
 * The four stages of the village funnel.
 *
 * ICT and CRA carry their own base — DT-done villages — and say so on the
 * bar, because a reader comparing "82% ICT approved" with "61% DT done" is
 * otherwise comparing two different denominators without being told.
 */
function villageStages(data) {
  const v = data.villages
  return [
    {
      label: 'Scope',
      count: v.total,
      pct: v.total ? 100 : null,
      remain: null,
      tick: null,
      delta: null,
      base: null,
    },
    {
      label: 'On air',
      count: v.on_air,
      pct: v.on_air_pct,
      remain: v.remain_on_air,
      tick: v.country_on_air_pct,
      delta: diff(v.on_air_pct, v.country_on_air_pct),
      base: null,
    },
    {
      label: 'DT done',
      count: v.dt_done,
      pct: v.dt_done_pct,
      remain: v.remain_dt,
      tick: v.country_dt_done_pct,
      delta: diff(v.dt_done_pct, v.country_dt_done_pct),
      base: null,
    },
    {
      label: 'ICT approved',
      count: v.ict_approved,
      pct: share(v.ict_approved, v.total),
      rate: v.ict_approved_pct,
      remain: v.ict_remained,
      tick: null,
      delta: diff(v.ict_approved_pct, v.country_ict_approved_pct),
      base: 'of DT done',
    },
    {
      label: 'CRA approved',
      count: v.cra_approved,
      pct: share(v.cra_approved, v.total),
      rate: v.cra_approved_pct,
      remain: v.cra_remained,
      tick: null,
      delta: diff(v.cra_approved_pct, v.country_cra_approved_pct),
      base: 'of DT done',
    },
  ]
}

function workItemStages(data) {
  const w = data.work_items
  return [
    { label: 'Scope', count: w.total, pct: w.total ? 100 : null, remain: null, tick: null, delta: null },
    {
      label: 'On air',
      count: w.on_air,
      pct: w.on_air_pct,
      remain: w.remain_on_air,
      tick: w.country_on_air_pct,
      delta: diff(w.on_air_pct, w.country_on_air_pct),
    },
    {
      label: 'DT done',
      count: w.dt_done,
      pct: w.dt_done_pct,
      remain: w.remain_dt,
      tick: w.country_dt_done_pct,
      delta: diff(w.dt_done_pct, w.country_dt_done_pct),
    },
  ]
}

function diff(value, benchmark) {
  if (value == null || benchmark == null) return null
  return Math.round((value - benchmark) * 10) / 10
}

/** A stage's width on the bar: its share of the scope, never of its own base. */
function share(count, total) {
  if (!total) return null
  return Math.round((count * 1000) / total) / 10
}

function LensRow({ selectable, lens, lensKey, keys, chip, onLens, onKey }) {
  if (!selectable) {
    return (
      <div className="kpi-lens">
        <span className="kpi-chip fixed">
          {lensLabel(lens)} · <strong>{lensKey ?? '…'}</strong>
        </span>
        {chip && <span className="kpi-chip">{chip}</span>}
        <Legend />
      </div>
    )
  }

  return (
    <div className="kpi-lens">
      <div className="kpi-segmented" role="group" aria-label="Lens">
        {LENSES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`kpi-seg ${lens === item.key ? 'active' : ''}`}
            aria-pressed={lens === item.key}
            onClick={() => onLens(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="kpi-person">
        <select
          className="input kpi-round"
          value={lensKey ?? ''}
          onChange={(event) => onKey(event.target.value)}
          aria-label={lensLabel(lens)}
        >
          {keys.length === 0 && <option value="">No data yet</option>}
          {keys.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      {chip && <span className="kpi-chip">{chip}</span>}
      <Legend />
    </div>
  )
}

function Legend() {
  return (
    <span className="kpi-legend">
      <i className="kpi-tick" aria-hidden="true" />
      Country average (weighted)
    </span>
  )
}

function FunnelCard({ title, total, stages }) {
  return (
    <section className="card card-pad kpi-card">
      <h3 className="kpi-card-title">{title}</h3>
      {total === 0 ? (
        <EmptyState title="Nothing in scope" hint="No work items here yet." />
      ) : (
        <ul className="kpi-bars">
          {stages.map((stage, index) => (
            <Bar key={stage.label} stage={stage} shade={FUNNEL_STEPS[Math.min(index, FUNNEL_STEPS.length - 1)]} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Bar({ stage, shade }) {
  const width = stage.pct == null ? 0 : Math.max(0, Math.min(100, stage.pct))
  const tone = stage.delta == null ? 'flat' : stage.delta >= 0 ? 'up' : 'down'
  return (
    <li className="kpi-bar-row">
      <div className="kpi-track">
        <div className="kpi-fill" style={{ width: `${width}%`, background: shade }}>
          <span className="kpi-bar-label">{stage.label}</span>
          <span className="kpi-bar-figure">
            {fmtCount(stage.count)}
            {stage.rate != null ? (
              <em>{fmtPct(stage.rate)} {stage.base}</em>
            ) : (
              stage.pct != null && <em>{fmtPct(stage.pct)}</em>
            )}
          </span>
        </div>
        {stage.tick != null && (
          <i
            className="kpi-tick-mark"
            style={{ left: `${Math.max(0, Math.min(100, stage.tick))}%` }}
            title={`Country average ${fmtPct(stage.tick)}`}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="kpi-bar-side">
        {stage.remain != null && <span className="kpi-remain">{fmtCount(stage.remain)} remain</span>}
        {stage.delta != null && (
          <span className={`kpi-pill ${tone}`}>{fmtDelta(stage.delta)}</span>
        )}
      </div>
    </li>
  )
}

function Heatmap({ rows, countryRow, threshold }) {
  return (
    <section className="card kpi-card">
      <header className="kpi-heatmap-head">
        <h3 className="kpi-card-title">Provinces</h3>
        <div className="kpi-scale">
          <span><i style={{ background: SHADES.betterStrong }} /> 5+ better</span>
          <span><i style={{ background: SHADES.better }} /> Better</span>
          <span><i style={{ background: SHADES.worse }} /> Worse</span>
          <span><i style={{ background: SHADES.worseStrong }} /> 5+ worse</span>
          <span className="kpi-scale-note">
            Fewer than {threshold} DT-done villages: shown, not compared
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="card-pad">
          <EmptyState title="No provinces in scope" hint="Nothing has been imported for this scope yet." />
        </div>
      ) : (
        <div className="kpi-table-wrap">
          <table className="kpi-table">
            <thead>
              <tr>
                <th scope="col">Province</th>
                <th scope="col">Villages</th>
                {HEATMAP_COLUMNS.map((column) => (
                  <th key={column.key} scope="col">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ProvinceRow key={row.province_fa ?? row.province} row={row} />
              ))}
              <ProvinceRow row={countryRow} country />
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ProvinceRow({ row, country }) {
  const low = row.low_sample
  return (
    <tr className={`${low ? 'low' : ''} ${country ? 'country' : ''}`.trim()}>
      <th scope="row">
        <span className="kpi-province">{row.province}</span>
        {row.cra_region && <span className="kpi-region">{row.cra_region}</span>}
      </th>
      <td className="kpi-plain">
        {fmtCount(row.villages)}
        <em>{fmtCount(row.dt_done_villages)} DT done</em>
      </td>
      {HEATMAP_COLUMNS.map((column) => {
        const cell = row[column.key]
        return (
          <td
            key={column.key}
            style={{ background: country ? 'var(--surface-3)' : cellShade(cell, low) }}
          >
            <span className="kpi-cell-value">{fmtPct(cell.pct)}</span>
            <em className={`kpi-cell-delta ${low ? 'muted' : deltaTone(cell)}`}>
              {low ? 'not compared' : country ? '—' : fmtDelta(cell.delta)}
            </em>
          </td>
        )
      })}
    </tr>
  )
}

function Contractors({ data, mode, onMode }) {
  return (
    <section className="card kpi-card">
      <header className="kpi-heatmap-head">
        <h3 className="kpi-card-title">Contractors</h3>
        <div className="kpi-segmented small" role="group" aria-label="Authority">
          {['ict', 'cra'].map((value) => (
            <button
              key={value}
              type="button"
              className={`kpi-seg ${mode === value ? 'active' : ''}`}
              aria-pressed={mode === value}
              onClick={() => onMode(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {!data ? (
        <div className="card-pad"><Skeleton rows={3} /></div>
      ) : data.rows.length === 0 ? (
        <div className="card-pad">
          <EmptyState title="No contractors" hint="No work items in these regions carry a DT SC yet." />
        </div>
      ) : (
        <div className="kpi-table-wrap">
          <table className="kpi-table contractors">
            <thead>
              <tr>
                <th scope="col">Contractor (DT SC)</th>
                <th scope="col">Total villages</th>
                <th scope="col">Approved</th>
                <th scope="col">Remained</th>
                <th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <ContractorRow key={row.contractor} row={row} />
              ))}
              <ContractorRow row={data.total} total />
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ContractorRow({ row, total }) {
  return (
    <tr className={total ? 'country' : ''}>
      <th scope="row">{row.contractor}</th>
      <td className="kpi-plain">{fmtCount(row.villages)}</td>
      <td className="kpi-plain">{fmtCount(row.approved)}</td>
      <td className="kpi-plain">{fmtCount(row.remained)}</td>
      <td>
        <div className="kpi-progress">
          <div
            className="kpi-progress-fill"
            style={{ width: `${row.pct == null ? 0 : Math.min(100, row.pct)}%` }}
          />
          <span>{fmtPct(row.pct)}</span>
        </div>
      </td>
    </tr>
  )
}

function Skeleton({ rows = 6 }) {
  return (
    <div className="kpi-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
