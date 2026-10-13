// Month (PM, Viewer): what happened in a month, and who it belongs to. No
// comparison with the previous month anywhere on this tab.
//
// Left, the measures (four groups); right, the selected measure split three
// ways side by side -- contractors, regional managers, coordinators -- each
// column adding up to the total. An owner opens Area scoped to them.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../../../context/ToastContext'
import MeasureList from './MeasureList'
import MonthPicker from './MonthPicker'
import PerfHeader from './PerfHeader'
import { useExport, useRpData } from './hooks'
import { CountUp, Fa, IconTile, Num, RpCard } from './parts'
import {
  HEADLINE_MEASURES,
  MONTH_DEFAULT_MEASURE,
  OWNER_COLUMNS,
  SECTION_ICONS,
  UNATTRIBUTED,
  fa,
  fmtCount,
  monthLabel,
  monthParam,
  ownerColumn,
  parseMonthParam,
} from './model'

export default function MonthTab({ search, onOpenOwner }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const asked = parseMonthParam(params.get('month'))
  const query = { ...(asked ? { month: monthParam(asked) } : {}), by: 'owners' }
  const { data, error, loading, retry } = useRpData('/kpi/month', query)
  const onExportError = useCallback((message) => toast.error('Export failed', message), [toast])
  const exporter = useExport(
    '/kpi/month.xlsx',
    data ? { month: monthParam(data.month) } : {},
    'UEP-roles-month.xlsx',
    onExportError,
  )

  const rows = (data?.sections ?? []).flatMap((s) => s.rows.map((r) => ({ ...r, section: s })))
  const askedMeasure = params.get('measure')
  const measure = rows.some((r) => r.key === askedMeasure) ? askedMeasure : MONTH_DEFAULT_MEASURE
  const selected = rows.find((r) => r.key === measure)

  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) next.set(name, value)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PerfHeader
        tab="month"
        scopeLabel="Whole country"
        title={data ? (
          <MonthPicker
            month={data.month}
            current={data.current_month}
            firstYear={data.first_year}
            onChange={(next) => update({ month: monthParam(next) })}
          />
        ) : 'Month'}
        subtitle={data && <Subtitle data={data} />}
        search={search}
        onExport={data ? exporter.run : undefined}
        exporting={exporter.busy}
      />
      <div className="rp-body rp-split">
        {data ? (
          <MeasureList
            label="Measures"
            value={measure}
            onChange={(key) => update({ measure: key })}
            groups={data.sections.map((section) => ({
              key: section.key,
              title: section.title,
              icon: SECTION_ICONS[section.key],
              unit: section.rows[0]?.unit,
              rows: section.rows.map((row) => ({
                key: row.key,
                label: row.label,
                kind: HEADLINE_MEASURES.has(row.key) ? 'headline' : 'minor',
                notRecorded: !row.recorded,
                value: <Num>{fmtCount(row.now)}</Num>,
              })),
            }))}
          />
        ) : (
          <RpCard className="rp-measures" label="Measures" loading={loading} error={error}
            onRetry={retry} />
        )}
        <RpCard className="rp-panel" label="Who it belongs to" loading={loading && !data}
          error={error} onRetry={retry}>
          {selected && (
            <OwnerPanel row={selected} data={data} onOpenOwner={onOpenOwner} />
          )}
        </RpCard>
      </div>
    </>
  )
}

function Subtitle({ data }) {
  if (data.running) {
    return <>So far · day <Fa>{fa(data.day)}</Fa> of <Fa>{fa(data.days_in_month)}</Fa></>
  }
  return <>Whole month</>
}

function OwnerPanel({ row, data, onOpenOwner }) {
  const recordedFrom = data.recorded_from
  let body
  if (!row.recorded) {
    body = (
      <p className="rp-empty">
        Not recorded. UEP has recorded this since{' '}
        <Fa>{monthLabel(recordedFrom.year, recordedFrom.month)}</Fa>.
      </p>
    )
  } else if (!row.now) {
    body = <p className="rp-empty">Nothing this month.</p>
  } else {
    body = (
      <div className="rp-owner-grid" key={row.key}>
        {OWNER_COLUMNS.map((column) => (
          <OwnerColumn
            key={column.key}
            column={column}
            entries={row.owners_by?.[column.key] ?? []}
            total={row.now}
            fewer={row.lower_is_better}
            onOpen={(name) => onOpenOwner({ lens: column.key, key: name })}
          />
        ))}
      </div>
    )
  }
  return (
    <>
      <header className="rp-panel-head">
        <IconTile name={SECTION_ICONS[row.section.key]} large />
        <div className="rp-panel-titles">
          <h2 className="rp-panel-title">{row.label}</h2>
          <p className="rp-panel-sub">Who it belongs to</p>
        </div>
        {row.recorded && (
          <div className="rp-panel-total">
            <CountUp value={row.now} className="rp-total" />
            <span className="rp-total-unit">
              {row.unit}
              {row.villages && <><br /><Num>{fmtCount(row.villages.now)}</Num> villages</>}
            </span>
          </div>
        )}
      </header>
      {body}
    </>
  )
}

function OwnerColumn({ column, entries, total, fewer, onOpen }) {
  const { listed, none, topTwo } = ownerColumn(entries, total)
  return (
    <section className={`rp-owner-col${fewer ? ' rp-fewer' : ''}`} aria-label={column.label}>
      <div className="rp-owner-head">
        <h3 className="rp-owner-title">{column.label}</h3>
        <span className="rp-owner-top">Top 2 hold <Num><b>{topTwo}%</b></Num></span>
      </div>
      <div className="rp-strip" role="img" aria-label={`${column.label} share of the total`}>
        {listed.map((o, i) => (
          <span
            key={o.name}
            className="rp-strip-seg"
            data-rank={o.rank}
            title={`${o.name} · ${fmtCount(o.count)}`}
            style={{ flexGrow: o.count, '--rp-delay': `${i * 40}ms` }}
          />
        ))}
      </div>
      <ol className="rp-owner-list">
        {listed.map((o) => {
          const inner = (
            <>
              <span className="rp-swatch" data-rank={o.rank} aria-hidden="true" />
              <span className="rp-owner-name" dir="auto" title={o.name}>{o.name}</span>
              <Num className="rp-owner-count">{fmtCount(o.count)}</Num>
              <Num className="rp-owner-share">{o.share}%</Num>
            </>
          )
          return (
            <li key={o.name}>
              {o.name === UNATTRIBUTED ? (
                <div className="rp-owner-row rp-owner-un"
                  title={`Not linked to any ${column.noun} on the day it happened`}>
                  {inner}
                </div>
              ) : (
                <button
                  type="button"
                  className={`rp-owner-row${o.rank === 1 || o.rank === 2 ? ' rp-owner-lead' : ''}`}
                  title={`Open ${o.name} in Area`}
                  onClick={() => onOpen(o.name)}
                >
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {none.length > 0 && (
        <p className="rp-owner-none" title={none.join(', ')}>
          {none.length} with none this month
        </p>
      )}
    </section>
  )
}
