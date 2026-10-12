import { Fragment, useMemo, useState } from 'react'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import {
  EmptyStep, Fa, HistoryButton, SearchBox, SiteIdButton, SkeletonRows, StepError,
  ToolToggle, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { isLate } from '../../lib/siteOrder'
import useStepData, { useExportRows } from './useStepData'

const PROCESS = {
  hc: {
    url: '/hc/queues/in-progress',
    rows: (data) =>
      data.flatMap((a) =>
        (a.pending || []).map((p) => ({
          id: p.task_id, work_item_id: p.work_item_id, site_code: p.site_code, province: p.province,
          contractor: a.contractor_name, days: p.days_waiting,
        })),
      ),
    description: 'Out with a health-check contractor · waiting counts since assigned',
  },
  dt: {
    url: '/hc/queues/dt-in-progress',
    rows: (data) =>
      data
        .filter((r) => r.status === 'with_contractor')
        .map((r) => ({
          id: r.work_item_id, work_item_id: r.work_item_id, site_code: r.site_code, province: r.province,
          contractor: r.contractor_name, days: r.days_since_assigned,
        })),
    description: 'Out with a drive-test contractor · waiting counts since assigned',
  },
}

const EXPORT_COLUMNS = [
  { label: 'Contractor', value: (r) => r.contractor },
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Province', value: (r) => r.province },
  { label: 'Waiting (days)', value: (r) => r.days },
]

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

/**
 * Steps 2 and 5 (UEP-06 §4.3): sites held by a contractor, grouped by
 * contractor, longest waiting first inside each group. Read-only: every row
 * waits on somebody else. "Late first" puts the groups with late sites on top.
 *
 * There is no Reassign button: no reassign endpoint exists yet (§7.4).
 */
export default function HeldStep({ process, step, figures, panelProps, onExport }) {
  const config = PROCESS[process]
  const { rows: data, error, retry } = useStepData(config.url)
  const [query, setQuery] = useState('')
  const [lateFirst, setLateFirst] = useState(false)
  const [history, setHistory] = useState({ id: null, code: null })
  const slaDays = figures?.sla_days

  const rows = useMemo(() => (data ? config.rows(data) : null), [data, config])
  const groups = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    const by = new Map()
    for (const r of rows) {
      if (q && !(r.site_code || '').toLowerCase().includes(q)) continue
      const key = r.contractor || ''
      if (!by.has(key)) by.set(key, [])
      by.get(key).push(r)
    }
    const out = [...by].map(([name, sites]) => ({
      name,
      sites: sites.sort((a, b) => (b.days ?? -1) - (a.days ?? -1)),
      late: sites.filter((s) => isLate(s.days, slaDays)).length,
    }))
    return out.sort((a, b) => (lateFirst ? b.late - a.late : 0) || a.name.localeCompare(b.name))
  }, [rows, query, lateFirst, slaDays])
  const flat = useMemo(() => groups.flatMap((g) => g.sites), [groups])
  useExportRows(onExport, EXPORT_COLUMNS, rows ? flat : null)

  const open = (r) => setHistory({ id: r.work_item_id, code: r.site_code })

  return (
    <WorkListCard
      {...panelProps}
      busy={!rows && !error}
      tools={
        <>
          <SearchBox value={query} onChange={setQuery} />
          <ToolToggle pressed={lateFirst} onChange={setLateFirst}>Show: Late first</ToolToggle>
        </>
      }
      description={config.description}
    >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep stepName={step.name} />
      ) : (
        <table className="uw-table" aria-label={step.name}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '22%' }} />
            <col />
            <col style={{ width: 'var(--uep-col-icon)' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Site ID</th>
              <th scope="col">Province</th>
              <th scope="col">Waiting · SLA {slaDays ?? '–'} d</th>
              <th scope="col" className="uw-col-icon"><span className="uw-sr-only">History</span></th>
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={4} />
          ) : (
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.name}>
                  <tr className="uw-group-row">
                    <th scope="colgroup" colSpan={4}>
                      <Fa>{g.name || 'No contractor'}</Fa>
                      <span className="uw-group-meta">
                        {plural(g.sites.length, 'site')}
                        {g.late > 0 && <> · <b className="uw-late">{g.late} late</b></>}
                      </span>
                    </th>
                  </tr>
                  {g.sites.map((r) => (
                    <tr key={r.id}>
                      <td><SiteIdButton siteCode={r.site_code} onClick={() => open(r)} /></td>
                      <td><Fa>{r.province}</Fa></td>
                      <td><WaitingCell days={r.days} slaDays={slaDays} /></td>
                      <td className="uw-col-icon"><HistoryButton siteCode={r.site_code} onClick={() => open(r)} /></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          )}
        </table>
      )}
      <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
    </WorkListCard>
  )
}
