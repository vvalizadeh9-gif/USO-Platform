// Performance (PM, Viewer) and My performance (everyone else): what one owner
// delivered month by month, and how fast. Results for owners who have them;
// activity for the people who act in UEP.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { canCompare } from '../../../lib/roles'
import { toPersianDigits } from '../../../lib/persianDigits'
import { currentShamsiPeriod, previousPeriod, shamsiMonthName } from '../../../lib/shamsi'
import PerfHeader from './PerfHeader'
import ScopePicker from './ScopePicker'
import { useExport, useRpData } from './hooks'
import { DeltaChip, Fa, Num, RateBar, RpCard } from './parts'
import { fmtCount, fmtDays, fmtPct, monthKey, scopeParams } from './model'

const SERIES = [
  { key: 'dt_done', label: 'DT done', colour: '#2F5FD0' },
  { key: 'ict_approved', label: 'ICT', colour: '#8E2F74' },
  { key: 'cra_approved', label: 'CRA', colour: '#17877B' },
]
const SPEED_SCALE_DAYS = 30

function monthChoices(count = 24) {
  const now = currentShamsiPeriod()
  if (!now) return []
  const out = []
  let { year, month } = now
  for (let i = 0; i < count; i += 1) {
    out.push({ value: monthKey({ year, month }),
      label: `${shamsiMonthName(month)} ${toPersianDigits(String(year))}` })
    ;({ year, month } = previousPeriod(year, month))
  }
  return out
}

export default function PerformanceTab({ scope, onScope, search }) {
  const { user } = useAuth()
  const comparer = canCompare(user)
  const [range, setRange] = useState({ from: null, to: null })
  const params = {
    ...scopeParams(scope),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  }
  const { data, error, loading } = useRpData('/kpi/performance', params)
  const exporter = useExport('/kpi/performance.xlsx', params, 'UEP-roles-performance.xlsx')
  const choices = monthChoices()
  const months = data?.months ?? []

  const picker = (which, fallback) => (
    <select
      className="rp-select rp-fa"
      aria-label={which === 'from' ? 'From month' : 'To month'}
      value={range[which] ?? (fallback ? monthKey(fallback) : '')}
      onChange={(e) => setRange((r) => ({ ...r, [which]: e.target.value }))}
    >
      {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )

  return (
    <>
      <PerfHeader
        tab="performance"
        scopeLabel={data?.scope?.label ?? 'Whole country'}
        title={comparer ? <ScopePicker scope={scope} onChange={onScope} /> : null}
        chip={data?.scope?.chip}
        search={search}
        dateControl={
          <span className="rp-range">
            {picker('from', months[0])}
            <span aria-hidden="true">–</span>
            {picker('to', months[months.length - 1])}
          </span>
        }
        onExport={exporter.run}
        exporting={exporter.busy}
        exportError={exporter.error}
      />
      <div className="rp-body rp-perf">
        {(loading && !data) || error ? (
          <RpCard title="Results" loading={loading && !data} error={error} />
        ) : null}
        {data?.results && (
          <>
            <div className="rp-tiles">
              {data.results.tiles.map((tile, i) => (
                <Tile key={tile.key} tile={tile} index={i} />
              ))}
            </div>
            <RpCard className="rp-rise" title="Delivered per month"
              aside={<SeriesLegend />}>
              <DeliveredChart series={data.results.series} />
            </RpCard>
          </>
        )}
        {data?.activity && <Activity activity={data.activity} />}
      </div>
    </>
  )
}

function Tile({ tile, index }) {
  return (
    <RpCard className="rp-tile rp-rise" style={{ '--rp-delay': `${index * 90}ms` }}>
      <p className="rp-headline-label">{tile.label}</p>
      <p className="rp-headline-figure">
        <Num className="rp-figure">{fmtPct(tile.rate)}</Num>
        <Num className="rp-headline-rate">{fmtCount(tile.count)}</Num>
      </p>
      <p className="rp-tile-line">
        <Fa>{shamsiMonthName(tile.movement_month.month)}</Fa>:{' '}
        {tile.movement == null ? <span className="rp-not-recorded">Not recorded</span>
          : <DeltaChip delta={tile.movement} small />}
      </p>
      <p className="rp-tile-line">
        National <Num>{fmtPct(tile.national_rate)}</Num>{' '}
        <DeltaChip delta={tile.national_gap} suffix=" pts" small />
      </p>
      {tile.role_average != null && (
        <p className="rp-tile-line">
          Role average <Num>{fmtPct(tile.role_average)}</Num>{' '}
          <DeltaChip delta={tile.role_gap} suffix=" pts" small />
        </p>
      )}
    </RpCard>
  )
}

function SeriesLegend() {
  return (
    <p className="rp-legend">
      {SERIES.map((s) => (
        <span key={s.key}><span className="rp-dot" style={{ background: s.colour }} /> {s.label}</span>
      ))}
      <span><span className="rp-dash" aria-hidden="true" /> ICT role average</span>
    </p>
  )
}

export function DeliveredChart({ series }) {
  const width = Math.max(series.length * 84, 300)
  const height = 180
  const top = 16
  const base = 150
  const max = Math.max(
    1,
    ...series.flatMap((m) => [
      ...SERIES.map((s) => m[s.key].count ?? 0),
      m.ict_role_average ?? 0,
    ]),
  )
  const y = (v) => base - ((base - top) * v) / max
  const slot = width / series.length
  const barW = Math.min(16, slot / 5)
  const avg = series
    .map((m, i) => (m.ict_role_average == null ? null : [i * slot + slot / 2, y(m.ict_role_average)]))
    .filter(Boolean)

  return (
    <svg className="rp-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="DT done, ICT and CRA villages per month">
      <defs>
        <pattern id="rp-stripes" width="6" height="6" patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <rect width="3" height="6" fill="white" opacity="0.45" />
        </pattern>
      </defs>
      <line x1="0" x2={width} y1={base} y2={base} className="rp-axis" />
      {series.map((m, i) => {
        const x0 = i * slot + slot / 2 - (barW * 3 + 8) / 2
        return (
          <g key={m.key}>
            {SERIES.map((s, j) => {
              const cell = m[s.key]
              const x = x0 + j * (barW + 4)
              if (!cell.recorded) {
                return <text key={s.key} x={x + barW / 2} y={base - 4} className="rp-chart-nr"
                  textAnchor="middle">–</text>
              }
              const h = base - y(cell.count)
              return (
                <g key={s.key}>
                  <rect x={x} y={base - h} width={barW} height={h} rx="2" fill={s.colour}>
                    <title>{`${s.label}: ${cell.count}`}</title>
                  </rect>
                  {m.running && h > 0 && (
                    <rect x={x} y={base - h} width={barW} height={h} rx="2" fill="url(#rp-stripes)" />
                  )}
                </g>
              )
            })}
            <text x={i * slot + slot / 2} y={base + 18} textAnchor="middle" className="rp-chart-month">
              {m.label_fa}
            </text>
            {!m.ict_approved.recorded && (
              <text x={i * slot + slot / 2} y={base - 18} textAnchor="middle" className="rp-chart-nr">
                Not recorded
              </text>
            )}
          </g>
        )
      })}
      {avg.length > 1 && (
        <polyline points={avg.map((p) => p.join(',')).join(' ')} className="rp-chart-avg" />
      )}
    </svg>
  )
}

function Activity({ activity }) {
  const peak = Math.max(1, ...activity.trend.flatMap((m) => [m.filed ?? 0, m.validated ?? 0]))
  return (
    <div className="rp-activity">
      <RpCard className="rp-rise" title="Activity in UEP">
        <ol className="rp-trend">
          {activity.trend.map((m) => (
            <li key={m.key}>
              <Fa className="rp-trend-month">{m.label_fa}</Fa>
              {m.recorded ? (
                <>
                  <span className="rp-trend-bar" style={{ width: `${(m.filed / peak) * 100}%` }} />
                  <Num>{fmtCount(m.filed)} filed</Num>
                  <span className="rp-trend-bar rp-trend-bar-alt"
                    style={{ width: `${(m.validated / peak) * 100}%` }} />
                  <Num>{fmtCount(m.validated)} validated</Num>
                </>
              ) : (
                <span className="rp-not-recorded">Not recorded</span>
              )}
            </li>
          ))}
        </ol>
      </RpCard>
      <RpCard className="rp-rise" title="Response times (median)">
        <ul className="rp-times">
          {activity.response_times.map((t) => (
            <li key={t.key}>
              <span className="rp-times-label">{t.label}</span>
              <Num className="rp-times-value">{fmtDays(t.median_days)}</Num>
              <RateBar value={t.median_days} tick={t.role_median_days} max={SPEED_SCALE_DAYS}
                label={`${fmtDays(t.median_days)}; role ${fmtDays(t.role_median_days)}`} />
              <span className="rp-times-role">
                role <Num>{fmtDays(t.role_median_days)}</Num> · <Num>{t.pairs}</Num> timed
              </span>
            </li>
          ))}
        </ul>
      </RpCard>
    </div>
  )
}
