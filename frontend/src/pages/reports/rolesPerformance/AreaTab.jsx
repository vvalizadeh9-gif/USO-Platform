// Area (PM, Viewer) and My area (everyone else): where things stand today,
// against national.
//
// Left, the scope's pipeline (Total villages, then five measures of equal
// weight); right, every member of one breakdown ranked on the selected
// measure by its gap to national, furthest behind first. A row opens
// Lifecycle Gaps with its lens and key.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../../components/ui'
import { useToast } from '../../../context/ToastContext'
import { shamsiDayLabel } from '../../../lib/shamsi'
import MeasureList from './MeasureList'
import PerfHeader from './PerfHeader'
import RankBar from './RankBar'
import ScopePicker from './ScopePicker'
import { useExport, useRpData } from './hooks'
import { Fa, IconTile, Num, RpCard } from './parts'
import {
  AREA_DEFAULT_MEASURE,
  AREA_MEASURES,
  BREAKDOWNS,
  SCOPE_GROUPS,
  fmtCount,
  fmtGap,
  fmtRate,
  gapPoints,
  gapsLink,
  rankLabel,
  rankRows,
  scopeParams,
  scopeValue,
} from './model'

export default function AreaTab({ scope, onScope, search }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [breakdown, setBreakdown] = useState(null)
  // A new scope starts on its own default breakdown (its kind is not offered).
  const scopeKey = scopeValue(scope)
  useEffect(() => setBreakdown(null), [scopeKey])
  const query = { ...scopeParams(scope), ...(breakdown ? { breakdown } : {}) }
  const { data, error, loading, retry } = useRpData('/kpi/area', query)
  const onExportError = useCallback((message) => toast.error('Export failed', message), [toast])
  const exporter = useExport('/kpi/area.xlsx', query, 'UEP-roles-area.xlsx', onExportError)

  const asked = params.get('measure')
  const measure = AREA_MEASURES.some((m) => m.key === asked) ? asked : AREA_DEFAULT_MEASURE
  const setMeasure = (key) => {
    const next = new URLSearchParams(params)
    next.set('measure', key)
    setParams(next, { replace: true })
  }
  const scoped = Boolean(data && data.scope.lens !== 'country')
  const stamp = shamsiDayLabel(data?.as_of)

  return (
    <>
      <PerfHeader
        tab="area"
        scopeLabel={scopeKind(data?.scope ?? scope)}
        title={<ScopePicker scope={scope} onChange={onScope} />}
        chip={data?.scope?.chip}
        subtitle={<>Today · as of the last CPM import {stamp ? <Fa>{stamp}</Fa> : 'not yet run'}</>}
        search={search}
        onExport={exporter.run}
        exporting={exporter.busy}
      />
      <div className="rp-body rp-split">
        {data ? (
          <MeasureList
            label="Pipeline"
            value={measure}
            onChange={setMeasure}
            groups={[{
              key: 'pipeline',
              title: 'Pipeline',
              icon: 'chart--column',
              unit: 'villages',
              rows: [
                {
                  key: 'villages',
                  label: 'Total villages',
                  kind: 'info',
                  value: <Num>{fmtCount(data.totals.villages)}</Num>,
                },
                ...AREA_MEASURES.map((m) => ({
                  key: m.key,
                  label: m.label,
                  kind: 'even',
                  value: <Num>{fmtCount(data.totals[m.key].count)}</Num>,
                  sub: (
                    <RateLine rate={data.totals[m.key].rate} national={data.national[m.key]}
                      scoped={scoped} />
                  ),
                })),
              ],
            }]}
          />
        ) : (
          <RpCard className="rp-measures" label="Pipeline" loading={loading} error={error}
            onRetry={retry} />
        )}
        <RpCard className="rp-panel" label="Ranking against national" loading={loading && !data}
          error={error} onRetry={retry}>
          {data && (
            <Ranking
              data={data}
              measure={measure}
              breakdown={data.breakdown}
              onBreakdown={setBreakdown}
            />
          )}
        </RpCard>
      </div>
    </>
  )
}

/** The eyebrow's scope: "Whole country", or the kind of thing chosen. */
function scopeKind(scope) {
  if (!scope || scope.lens === 'country') return 'Whole country'
  return SCOPE_GROUPS.find((g) => g.lens === scope.lens)?.one ?? 'Whole country'
}

/** "94%", and when scoped " · +3 pts" against national. */
function RateLine({ rate, national, scoped }) {
  const gap = fmtGap(gapPoints(rate, national))
  return (
    <>
      <Num>{fmtRate(rate)}</Num>
      {scoped && (
        <> · <Num className={`rp-gap rp-gap-${gap.tone}`}>{gap.text}</Num></>
      )}
    </>
  )
}

function Ranking({ data, measure, breakdown, onBreakdown }) {
  const info = AREA_MEASURES.find((m) => m.key === measure)
  const noun = BREAKDOWNS[breakdown]
  const national = data.national[measure]
  const { compared, low, behind } = rankRows(data.rows, measure, national)

  return (
    <>
      <header className="rp-panel-head">
        <IconTile name={info.icon} large />
        <div className="rp-panel-titles">
          <h2 className="rp-panel-title">{info.label} by {noun.one}</h2>
          <p className="rp-panel-sub">Behind national first</p>
        </div>
        <p className="rp-behind">
          <Num><b>{fmtCount(behind)}</b></Num> of <Num>{fmtCount(compared.length)}</Num>{' '}
          {compared.length === 1 ? noun.one : noun.many}
          <br />below national
        </p>
      </header>
      <div className="rp-rank-controls">
        <SegmentedControl
          options={data.breakdowns.map((key) => ({ key, label: BREAKDOWNS[key].label }))}
          value={breakdown}
          onChange={onBreakdown}
          label="Breakdown"
        />
        <span className="rp-rank-key">
          <span className="rp-rank-key-tick" aria-hidden="true" />
          National <Num>{fmtRate(national)}</Num>
        </span>
      </div>
      <ol className="rp-rank-list" aria-label={`${info.label} by ${noun.one}`}>
        <li className="rp-rank-row rp-rank-national">
          <span className="rp-rank-name">National average</span>
          <RankBar rate={national} reference={national} national
            label={`National average ${fmtRate(national)}`} />
          <Num className="rp-rank-rate">{fmtRate(national)}</Num>
          <span className="rp-gap" />
        </li>
        {compared.map((row) => {
          const gap = fmtGap(row.gap)
          return (
            <li key={row.name}>
              <Link to={gapsLink(breakdown, row)} className="rp-rank-row"
                title={`Open ${row.name} in Lifecycle Gaps`}>
                <span className="rp-rank-name" dir="auto">{row.name}</span>
                <RankBar rate={row.rate} reference={national}
                  label={rankLabel(row.name, row.rate, national)} />
                <Num className="rp-rank-rate">{fmtRate(row.rate)}</Num>
                <Num className={`rp-gap rp-gap-${gap.tone}`}>{gap.text}</Num>
              </Link>
            </li>
          )
        })}
        {low.map((row) => (
          <li key={row.name}>
            <Link to={gapsLink(breakdown, row)} className="rp-rank-row rp-rank-low"
              title={`Open ${row.name} in Lifecycle Gaps`}>
              <span className="rp-rank-name" dir="auto">{row.name}</span>
              <span className="rp-rank-nc">
                Not compared · fewer than {data.low_sample_threshold} DT-done villages
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  )
}
