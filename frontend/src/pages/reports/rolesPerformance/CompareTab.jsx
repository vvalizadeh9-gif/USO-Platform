// Compare (PM, Viewer): owners of one kind, ranked. One kind at a time,
// never mixed. Low-sample owners read "Not compared" and sit last. A row
// opens that owner in Performance.
import { useState } from 'react'
import { SegmentedControl } from '../../../components/ui'
import { toPersianDigits } from '../../../lib/persianDigits'
import { currentShamsiPeriod, previousPeriod, shamsiMonthName } from '../../../lib/shamsi'
import PerfHeader from './PerfHeader'
import { useExport, useRpData } from './hooks'
import { DeltaChip, Fa, NotCompared, Num, RateBar, RpCard } from './parts'
import { fmtCount, fmtDays, fmtPct, monthKey } from './model'

const MEASURES = [
  { key: 'dt', label: 'DT done' },
  { key: 'onair', label: 'On air' },
  { key: 'ict', label: 'ICT' },
  { key: 'cra', label: 'CRA' },
]
const SPEED = { key: 'speed', label: 'Speed' }
const VIEWS = [
  { key: 'ranking', label: 'Ranking' },
  { key: 'months', label: 'Months' },
]
const SPEED_SCALE_DAYS = 30
// Compare's kinds, to the lens Performance opens an owner under.
const LENS_OF_KIND = {
  contractor: 'contractor', coordinator: 'coordinator', rm: 'rm',
  province: 'province', region: 'region',
}

function periodChoices(count = 12) {
  const now = currentShamsiPeriod()
  const out = [{ value: 'all', label: '' }]
  if (!now) return out
  let { year, month } = now
  out[0].label = `از ابتدا تا ${shamsiMonthName(month)} ${toPersianDigits(String(year))}`
  for (let i = 0; i < count; i += 1) {
    out.push({ value: `month:${monthKey({ year, month })}`,
      label: `${shamsiMonthName(month)} ${toPersianDigits(String(year))}` })
    ;({ year, month } = previousPeriod(year, month))
  }
  return out
}

export default function CompareTab({ onOpenOwner, search }) {
  const [kind, setKind] = useState('contractor')
  const [measure, setMeasure] = useState('ict')
  const [period, setPeriod] = useState('all')
  const [view, setView] = useState('ranking')
  const params = { kind, measure, period }
  const { data, error, loading } = useRpData('/kpi/compare', params)
  const exporter = useExport('/kpi/compare.xlsx', params, 'UEP-roles-compare.xlsx')

  const kinds = data?.kinds ?? []
  const speedOk = kinds.find((k) => k.key === kind)?.speed ?? ['contractor', 'coordinator'].includes(kind)
  const choose = (next) => {
    setKind(next)
    // Kinds that do not act in UEP have no speed: back to ICT.
    const acts = kinds.find((k) => k.key === next)?.speed
    if (measure === 'speed' && !acts) setMeasure('ict')
  }
  const periods = periodChoices()
  const kindLabel = kinds.find((k) => k.key === kind)?.label ?? 'Owners'

  return (
    <>
      <PerfHeader
        tab="compare"
        scopeLabel="Whole country"
        title={kindLabel}
        search={search}
        dateControl={
          <select className="rp-select rp-fa" aria-label="Period" value={period}
            onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        }
        onExport={exporter.run}
        exporting={exporter.busy}
        exportError={exporter.error}
      />
      <div className="rp-controls">
        <div className="rp-kind-chips" role="group" aria-label="Kind">
          {(kinds.length ? kinds : [{ key: 'contractor', label: 'Contractors' }]).map((k) => (
            <button key={k.key} type="button" className="rp-kind-chip"
              aria-pressed={k.key === kind} onClick={() => choose(k.key)}>
              {k.label}{k.count != null && <> <Num>{k.count}</Num></>}
            </button>
          ))}
        </div>
        <SegmentedControl
          options={speedOk ? [...MEASURES, SPEED] : MEASURES}
          value={data?.measure ?? measure}
          onChange={setMeasure}
          label="Measure"
        />
        <SegmentedControl options={VIEWS} value={view} onChange={setView} label="View" />
      </div>
      <div className="rp-body rp-compare">
        {data && <HeadlineStrip data={data} />}
        <RpCard
          className="rp-card-fill rp-rise"
          title={data?.speed_label ?? null}
          loading={loading && !data}
          error={error}
          empty={data && !data.rows.length}
        >
          {data && view === 'ranking' && (
            <Ranking data={data} onOpen={(row) => onOpenOwner({ lens: LENS_OF_KIND[data.kind], key: row.name })} />
          )}
          {data && view === 'months' && (
            <MonthsView data={data} onOpen={(row) => onOpenOwner({ lens: LENS_OF_KIND[data.kind], key: row.name })} />
          )}
        </RpCard>
      </div>
    </>
  )
}

function fmtValue(data, value) {
  return data.unit === 'days' ? fmtDays(value) : fmtPct(value)
}

function HeadlineStrip({ data }) {
  const h = data.headline
  const items = [
    ['National', h.national],
    ['Average', h.average],
    ['Highest', h.highest?.value, h.highest?.name],
    ['Lowest', h.lowest?.value, h.lowest?.name],
  ]
  return (
    <dl className="rp-strip">
      {items.map(([label, value, name]) => (
        <div key={label} className="rp-strip-item">
          <dt>{label}</dt>
          <dd>
            <Num className="rp-strip-value">{fmtValue(data, value)}</Num>
            {name && <span className="rp-strip-name" dir="auto">{name}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Ranking({ data, onOpen }) {
  const max = data.unit === 'days' ? SPEED_SCALE_DAYS : 100
  return (
    <div className="rp-table-scroll">
      <table className="rp-table rp-ranking">
        <thead>
          <tr>
            <th scope="col" className="rp-right">#</th>
            <th scope="col">Name</th>
            <th scope="col">{data.unit === 'days' ? 'Median' : 'Rate'}</th>
            <th scope="col" className="rp-right">{data.unit === 'days' ? 'Timed' : 'Count'}</th>
            <th scope="col" className="rp-right">vs national</th>
            <th scope="col">Six months</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.name} className={`rp-click${row.low_sample ? ' rp-low' : ''}`}
              tabIndex={0} onClick={() => onOpen(row)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(row)}>
              <td className="rp-right"><Num>{row.rank ?? '–'}</Num></td>
              <th scope="row"><span dir="auto">{row.label}</span></th>
              <td>
                {row.low_sample ? <NotCompared /> : (
                  <span className="rp-authority">
                    <Num>{fmtValue(data, row.rate)}</Num>
                    <RateBar value={row.rate} tick={data.headline.national} max={max}
                      label={`${fmtValue(data, row.rate)}; national ${fmtValue(data, data.headline.national)}`} />
                  </span>
                )}
              </td>
              <td className="rp-right"><Num>{fmtCount(row.count)}</Num></td>
              <td className="rp-right">
                {!row.low_sample && (
                  <DeltaChip delta={row.delta} lowerIsBetter={data.lower_is_better}
                    suffix={data.unit === 'days' ? ' d' : ' pts'} small />
                )}
              </td>
              <td><Spark series={row.series} speed={data.unit === 'days'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function seriesValue(entry, speed) {
  return speed ? entry.median_days : entry.count
}

export function Spark({ series, speed }) {
  const values = series.map((e) => seriesValue(e, speed))
  const known = values.filter((v) => v != null)
  if (!known.length) return <span className="rp-not-recorded">Not recorded</span>
  const max = Math.max(1, ...known)
  const w = 84
  const h = 22
  const step = w / Math.max(series.length - 1, 1)
  const points = values
    .map((v, i) => (v == null ? null : [i * step, h - 2 - (v / max) * (h - 4)]))
    .filter(Boolean)
  // The latest month as a dot, so a series with one recorded month still shows.
  const [lastX, lastY] = points[points.length - 1]
  return (
    <svg className="rp-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {points.length > 1 && <polyline points={points.map((p) => p.join(',')).join(' ')} />}
      <circle cx={lastX} cy={lastY} r="2.5" />
    </svg>
  )
}

function MonthsView({ data, onOpen }) {
  const speed = data.unit === 'days'
  const peak = Math.max(1, ...data.rows.flatMap((r) => r.series.map((e) => e.count ?? 0)))
  return (
    <div className="rp-table-scroll">
      <table className="rp-table rp-lanes">
        <thead>
          <tr>
            <th scope="col">Name</th>
            {data.series_months.map((m) => (
              <th key={monthKey(m)} scope="col" className="rp-center"><Fa>{m.label_fa}</Fa></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.name} className="rp-click" tabIndex={0} onClick={() => onOpen(row)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(row)}>
              <th scope="row"><span dir="auto">{row.label}</span></th>
              {row.series.map((entry, i) => {
                const size = entry.count ? 6 + (entry.count / peak) * 18 : 0
                const last = i === row.series.length - 1
                return (
                  <td key={entry.key} className="rp-center">
                    {entry.recorded ? (
                      <span
                        className={`rp-bubble${last ? ' rp-bubble-running' : ''}`}
                        style={{ width: size, height: size }}
                        title={speed ? fmtDays(entry.median_days) : fmtCount(entry.count)}
                      />
                    ) : <span className="rp-not-recorded">–</span>}
                    <Num className="rp-bubble-count">{fmtCount(entry.count)}</Num>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
