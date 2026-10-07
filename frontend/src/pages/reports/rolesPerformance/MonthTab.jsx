// Month (PM, Viewer): what happened this month, against last month up to the
// same day. Four section cards; in Overall each row is a block row, in an
// owner view each row is a ranked line of owners, highest first.
import { useState } from 'react'
import { SegmentedControl } from '../../../components/ui'
import { toPersianDigits } from '../../../lib/persianDigits'
import { currentShamsiPeriod, previousPeriod, shamsiMonthName } from '../../../lib/shamsi'
import PerfHeader from './PerfHeader'
import { useExport, useRpData } from './hooks'
import { CountUp, DeltaChip, Fa, Num, RpCard } from './parts'
import { ROW_COLOURS, barWidth, blocks, fmtCount } from './model'

const VIEWS = [
  { key: 'all', label: 'Overall' },
  { key: 'coordinator', label: 'Coordinators' },
  { key: 'contractor', label: 'Contractors' },
  { key: 'rm', label: 'Regional managers' },
]

function monthOptions(count = 12) {
  const now = currentShamsiPeriod()
  if (!now) return []
  const out = []
  let { year, month } = now
  for (let i = 0; i < count; i += 1) {
    out.push({
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: `${shamsiMonthName(month)} ${toPersianDigits(String(year))}`,
    })
    ;({ year, month } = previousPeriod(year, month))
  }
  return out
}

export default function MonthTab({ search }) {
  const [month, setMonth] = useState(null)
  const [view, setView] = useState('all')
  const params = { ...(month ? { month } : {}), by: view }
  const { data, error, loading } = useRpData('/kpi/month', params)
  const exporter = useExport('/kpi/month.xlsx', params, 'UEP-roles-month.xlsx')
  const options = monthOptions()

  const title = data ? <Fa>{data.month.label_fa}</Fa> : 'Month'
  return (
    <>
      <PerfHeader
        tab="month"
        scopeLabel="Whole country"
        title={title}
        subtitle={data && <Subtitle data={data} />}
        search={search}
        dateControl={
          <select
            className="rp-select rp-fa"
            aria-label="Month"
            value={month ?? options[0]?.value ?? ''}
            onChange={(e) => setMonth(e.target.value === options[0]?.value ? null : e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        }
        onExport={exporter.run}
        exporting={exporter.busy}
        exportError={exporter.error}
      />
      <div className="rp-controls">
        <SegmentedControl options={VIEWS} value={view} onChange={setView} label="Month view" />
        <Legend view={view} data={data} />
      </div>
      <div className="rp-body rp-month" key={view}>
        {(data?.sections ?? Array.from({ length: 4 }, (_, i) => ({ key: i }))).map((section, i) => (
          <RpCard
            key={section.key}
            className="rp-rise"
            style={{ '--rp-delay': `${i * 90}ms` }}
            title={section.title}
            aside={view === 'all' && section.block && (
              <span className="rp-chip">■ = {section.block.value} {section.block.unit}</span>
            )}
            loading={loading && !data}
            error={error}
          >
            {section.rows?.map((row, r) => (
              <MonthRow key={row.key} row={row} block={section.block} view={view} rowIndex={r} />
            ))}
          </RpCard>
        ))}
      </div>
    </>
  )
}

function Subtitle({ data }) {
  const ref = <Fa>{shamsiMonthName(data.ref_month.month)}</Fa>
  if (data.running) {
    return (
      <>
        Day {data.day} of {data.days_in_month} · compared with {ref} up to the same day
      </>
    )
  }
  return <>Whole month · compared with the whole of {ref}</>
}

function Legend({ view, data }) {
  if (view === 'all') {
    return (
      <p className="rp-legend" aria-label="Legend">
        <span className="rp-key rp-key-done" aria-hidden="true" /> the month
        <span className="rp-key rp-key-beyond" aria-hidden="true" /> more than last month
        <span className="rp-key rp-key-short" aria-hidden="true" /> short of last month
      </p>
    )
  }
  const ref = data ? <Fa>{shamsiMonthName(data.ref_month.month)}</Fa> : 'last month'
  return <p className="rp-legend">Highest first · +/− against each owner&apos;s own {ref}</p>
}

function MonthRow({ row, block, view, rowIndex }) {
  const colour = ROW_COLOURS[row.key] ?? ROW_COLOURS.on_air
  return (
    <div className="rp-month-row" data-row={row.key}>
      <div className="rp-month-label">
        <span className="rp-dot" style={{ background: colour.ink }} aria-hidden="true" />
        {row.label}
      </div>
      <div className="rp-month-total">
        {row.recorded ? (
          <>
            <CountUp value={row.now} className="rp-total" />
            <span className="rp-unit">
              {row.villages
                ? <> {row.unit} · <Num>{fmtCount(row.villages.now)}</Num> villages</>
                : <> {row.unit}</>}
            </span>
            {row.ref_recorded && <DeltaChip delta={row.delta} lowerIsBetter={row.lower_is_better} />}
          </>
        ) : (
          <span className="rp-not-recorded">Not recorded</span>
        )}
      </div>
      <div className="rp-month-visual">
        {row.recorded && (view === 'all'
          ? <BlockRow row={row} per={block.value} colour={colour} rowIndex={rowIndex} />
          : <OwnerLine owners={row.owners ?? []} colour={colour} lowerIsBetter={row.lower_is_better} />)}
      </div>
    </div>
  )
}

export function BlockRow({ row, per, colour, rowIndex = 0 }) {
  const items = blocks(row.now, row.ref_recorded ? row.ref : null, per)
  return (
    <div
      className="rp-blocks"
      role="img"
      aria-label={`${fmtCount(row.now)} this month${row.ref != null ? `, ${fmtCount(row.ref)} last month` : ''}`}
    >
      {items.map((b, i) => (
        <span
          key={i}
          className={`rp-block rp-block-${b.kind}`}
          style={{
            '--rp-ink': colour.ink,
            '--rp-soft': colour.soft,
            '--rp-fill': `${Math.round(b.fill * 100)}%`,
            '--rp-delay': `${rowIndex * 50 + i * 30}ms`,
          }}
        />
      ))}
    </div>
  )
}

export function OwnerLine({ owners, colour, lowerIsBetter }) {
  const leader = Math.max(0, ...owners.map((o) => o.now ?? 0))
  return (
    <ol className="rp-owners">
      {owners.map((owner, i) => (
        <li key={owner.name} className="rp-owner rp-rise" style={{ '--rp-delay': `${i * 40}ms` }}>
          <span className="rp-owner-name" dir="auto">{owner.name}</span>
          <span className="rp-owner-figures">
            <Num className="rp-owner-value">{fmtCount(owner.now)}</Num>
            {owner.ref_recorded && (
              <DeltaChip delta={owner.delta} lowerIsBetter={lowerIsBetter} small />
            )}
          </span>
          <span
            className="rp-owner-bar"
            style={{ width: `${barWidth(owner.now, leader)}px`, background: colour.ink }}
            aria-hidden="true"
          />
        </li>
      ))}
    </ol>
  )
}
