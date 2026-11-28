// The DT done outcome and the three side loops (UEP-06 §4.3).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import { ConfirmDialog } from '../../components/ui'
import {
  EmptyStep, Fa, SearchBox, SiteIdButton, SkeletonRows, StepError, ToolSelect, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { roleLabel } from '../../lib/roles'
import useStepData, { useExportRows } from './useStepData'
import { formatNumber } from '../../lib/numbers'

const DAY = 24 * 60 * 60 * 1000
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : null)

function useHistoryDrawer() {
  const [history, setHistory] = useState({ id: null, code: null })
  const drawer = (
    <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
  )
  return [(r) => setHistory({ id: r.work_item_id, code: r.site_code }), drawer]
}

/** DT done: an outcome, not a queue. The sites are on the DT site list. */
export function DoneStep({ figures, panelProps, onExport }) {
  useExportRows(onExport, null, null)
  return (
    <WorkListCard {...panelProps} tools={<b className="uw-card-title">DT done</b>} description="Approved drive tests move on to acceptance">
      <div className="uw-state">
        <span className="uw-state-icon is-done"><Icon name="checkmark" size={20} /></span>
        <b>
          {figures ? `${figures.count.toLocaleString('en-US')} sites have a completed drive test` : 'Sites with a completed drive test'}
        </b>
        <span>Their drive test is approved. Each one is listed on the drive-test site list.</span>
        <Link className="uw-btn" to="/drive-test/sites?bucket=done">
          Open the DT site list <Icon name="arrow--right" size={16} />
        </Link>
      </div>
    </WorkListCard>
  )
}

const REMEDIATION_EXPORT = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Province', value: (r) => r.province },
  { label: 'Category', value: (r) => r.category },
  { label: 'Owning team', value: (r) => (r.owner_role ? roleLabel(r.owner_role) : '') },
  { label: 'Issue', value: (r) => r.issue },
  { label: 'Open (days)', value: (r) => r.days_open },
  { label: 'Late (days)', value: (r) => r.days_late },
]

/** A fix's SLA in days: its category's deadline, from opened to due. */
const slaOf = (r) => (r.due_at && r.opened_at ? Math.round((new Date(r.due_at) - new Date(r.opened_at)) / DAY) : null)

/** One tile per owning team: open, late and the SLA (a range when the team's
 * categories differ). `shared`: a team owns several categories, so the list
 * names the category under the team. */
function teamsOf(rows) {
  const byTeam = new Map()
  for (const r of rows) {
    const key = r.owner_role || ''
    const t = byTeam.get(key) || { key, open: 0, late: 0, slas: new Set(), categories: new Set() }
    t.open += 1
    if (r.days_late > 0) t.late += 1
    if (slaOf(r) != null) t.slas.add(slaOf(r))
    if (r.category) t.categories.add(r.category)
    byTeam.set(key, t)
  }
  const teams = [...byTeam.values()].sort((a, b) => teamName(a.key).localeCompare(teamName(b.key)))
  return { teams, shared: teams.some((t) => t.categories.size > 1) }
}

const teamName = (role) => (role ? roleLabel(role) : 'No team')

function slaText(slas) {
  if (!slas.size) return null
  const lo = Math.min(...slas)
  const hi = Math.max(...slas)
  return lo === hi ? `SLA ${lo} d` : `SLA ${lo}–${hi} d`
}

/** Every open fix, across every owning team (UEP-31 §5). Read-only: closing a
 * fix stays with the team doing it. Late is the fix's own due date, set by
 * its category; the most late come first. */
export function RemediationStep({ step, panelProps, onExport }) {
  const { rows, error, retry } = useStepData('/hc/queues/remediations')
  const [team, setTeam] = useState(null)
  const [query, setQuery] = useState('')
  const [province, setProvince] = useState('')
  const [openHistory, drawer] = useHistoryDrawer()
  const { teams, shared } = useMemo(() => teamsOf(rows || []), [rows])
  const provinces = useMemo(() => [...new Set((rows || []).map((r) => r.province).filter(Boolean))].sort(), [rows])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows || []).filter(
      (r) =>
        (team === null || (r.owner_role || '') === team) &&
        (!province || r.province === province) &&
        (!q || (r.site_code || '').toLowerCase().includes(q) || (r.issue || '').toLowerCase().includes(q)),
    )
  }, [rows, team, query, province])
  useExportRows(onExport, REMEDIATION_EXPORT, rows ? shown : null)
  const picked = teams.find((t) => t.key === team)

  return (
    <div {...panelProps} className="uw-remediation">
      {teams.length > 0 && (
        <div className="uw-teams" role="group" aria-label="Owning teams" style={{ '--n': teams.length }}>
          {teams.map((t) => (
            <button
              key={t.key}
              type="button"
              className="uw-team"
              aria-pressed={team === t.key}
              onClick={() => setTeam(team === t.key ? null : t.key)}
            >
              <span className="uw-team-name">{teamName(t.key)}</span>
              <span className="uw-team-open"><b>{formatNumber(t.open)}</b> open</span>
              <span className="uw-team-meta">
                {t.late > 0 && <span className="uw-team-late">{formatNumber(t.late)} late</span>}
                {slaText(t.slas) && <span>{slaText(t.slas)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <WorkListCard
        busy={!rows && !error}
        tools={
          <>
            <SearchBox value={query} onChange={setQuery} label="Search site ID or issue" placeholder="Site or issue…" />
            <ToolSelect label="Province" value={province} onChange={setProvince} options={provinces} allLabel="All provinces" />
          </>
        }
        description={
          picked && (
            <>
              {teamName(picked.key)} · {formatNumber(shown.length)} {shown.length === 1 ? 'site' : 'sites'}{' '}
              <button type="button" className="uw-link" onClick={() => setTeam(null)}>Show all</button>
            </>
          )
        }
      >
        {error && !rows ? (
          <StepError stepName={step.name} onRetry={retry} />
        ) : rows && rows.length === 0 ? (
          <EmptyStep stepName={step.name} />
        ) : (
          <table className="uw-table uw-table-wrap" aria-label={step.name}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '22%' }} />
              <col />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Site ID</th>
                <th scope="col">Province</th>
                <th scope="col">Owning team</th>
                <th scope="col">Issue</th>
                <th scope="col" aria-sort="descending">Open</th>
              </tr>
            </thead>
            {!rows ? (
              <SkeletonRows columns={5} />
            ) : (
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="uw-site">
                        <SiteIdButton siteCode={r.site_code} onClick={() => openHistory(r)} />
                        {r.reroute_pending && <span className="uw-flag">Disputed</span>}
                      </span>
                    </td>
                    <td><Fa>{r.province}</Fa></td>
                    <td>
                      <span className="uw-cell-two">
                        {teamName(r.owner_role)}
                        {shared && r.category && <span className="uw-sub">{r.category}</span>}
                      </span>
                    </td>
                    <td className="uw-wrap">
                      {r.technologies.length > 0 && <b>{r.technologies.join(', ')}: </b>}
                      <Fa>{r.issue || 'No detail recorded'}</Fa>
                    </td>
                    <td><WaitingCell days={r.days_open} late={r.days_late > 0} /></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        )}
        {drawer}
      </WorkListCard>
    </div>
  )
}

/** Fixes whose owning team says the category is wrong. Owners may propose a
 * move but not make one; the decision is here. */
export function ReroutesStep({ step, panelProps, onExport }) {
  const toast = useToast()
  const { confirmAction } = useWork()
  const { rows, error, retry } = useStepData('/hc/queues/reroutes')
  const [pending, setPending] = useState(null) // { row, approve }
  const [busy, setBusy] = useState(false)
  const [openHistory, drawer] = useHistoryDrawer()
  useExportRows(onExport, null, null)

  async function decide() {
    if (!pending) return
    setBusy(true)
    try {
      await api.post(`/hc/fixes/${pending.row.id}/reroute/decide`, { approve: pending.approve })
      const { row, approve } = pending
      setPending(null)
      confirmAction({
        text: approve
          ? `✓ ${row.site_code} is now ${row.to_category}. The new team's clock starts today.`
          : `✓ ${row.site_code} stays with ${row.from_category}.`,
      })
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkListCard {...panelProps} busy={!rows && !error} tools={<b className="uw-card-title">Re-route requests</b>} description="Oldest request first · the fix stays with its current team until you decide">
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : !rows ? (
        <table className="uw-table" aria-hidden="true"><SkeletonRows columns={1} rows={4} /></table>
      ) : rows.length === 0 ? (
        <EmptyStep stepName={step.name} />
      ) : (
        <ul className="uw-decisions">
          {rows.map((r) => (
            <li key={r.id} className="uw-decision">
              <div className="uw-decision-body">
                <p className="uw-decision-head">
                  <SiteIdButton siteCode={r.site_code} onClick={() => openHistory(r)} />
                  <Fa>{r.province}</Fa>
                  <span className="uw-muted">open {r.days_open} {r.days_open === 1 ? 'day' : 'days'}</span>
                </p>
                <p className="uw-decision-move">
                  <span className="uw-flag">{r.from_category}</span>
                  <Icon name="arrow--right" size={16} label="to" />
                  <span className="uw-flag is-strong">{r.to_category}</span>
                </p>
                <p className="uw-decision-reason"><Fa>{r.reason || 'No reason was given.'}</Fa></p>
                <p className="uw-muted">Proposed by <Fa>{r.proposed_by || 'the owning team'}</Fa></p>
              </div>
              <div className="uw-decision-actions">
                <button type="button" className="uw-btn uw-btn-primary" onClick={() => setPending({ row: r, approve: true })}>Move it</button>
                <button type="button" className="uw-btn" onClick={() => setPending({ row: r, approve: false })}>Keep it</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.approve ? 'Move this fix?' : 'Keep this fix where it is?'}
        message={
          pending?.approve
            ? `${pending.row.site_code} moves from ${pending.row.from_category} to ${pending.row.to_category}. The deadline restarts, because the new team has not had the site until now.`
            : `${pending?.row.site_code} stays with ${pending?.row.from_category}, and its deadline keeps running.`
        }
        confirmLabel={pending?.approve ? 'Yes, move it' : 'Yes, keep it'}
        busy={busy}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />
      {drawer}
    </WorkListCard>
  )
}

const SENT_BACK_EXPORT = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Contractor', value: (r) => r.contractor_name },
  { label: 'Reason sent back', value: (r) => r.sent_back_comment },
  { label: 'Waiting (days)', value: (r) => r.days },
]

/** Drive tests a reviewer sent back, waiting on the contractor's resubmission.
 * Waiting counts from the day it was sent back. */
export function SentBackStep({ step, figures, panelProps, onExport }) {
  const { rows: data, error, retry } = useStepData('/hc/queues/dt-in-progress')
  const [openHistory, drawer] = useHistoryDrawer()
  const slaDays = figures?.sla_days
  const rows = useMemo(
    () =>
      data
        ? data
            .filter((r) => r.status === 'sent_back')
            .map((r) => ({ ...r, days: daysSince(r.sent_back_at) ?? r.days_since_assigned }))
            .sort((a, b) => b.days - a.days)
        : null,
    [data],
  )
  useExportRows(onExport, SENT_BACK_EXPORT, rows)

  return (
    <WorkListCard {...panelProps} busy={!rows && !error} tools={<b className="uw-card-title">Sent back</b>} description="Longest waiting first · waiting counts since it was sent back">
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep stepName={step.name} />
      ) : (
        <table className="uw-table uw-table-wrap" aria-label={step.name}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '18%' }} />
            <col />
            <col style={{ width: '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Site ID</th>
              <th scope="col">Contractor</th>
              <th scope="col">Reason sent back</th>
              <th scope="col">Waiting · SLA {slaDays ?? '–'} d</th>
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={4} />
          ) : (
            <tbody>
              {rows.map((r) => (
                <tr key={r.work_item_id}>
                  <td><SiteIdButton siteCode={r.site_code} onClick={() => openHistory(r)} /></td>
                  <td><Fa>{r.contractor_name}</Fa></td>
                  <td className="uw-wrap"><Fa>{r.sent_back_comment}</Fa></td>
                  <td><WaitingCell days={r.days} slaDays={slaDays} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      )}
      {drawer}
    </WorkListCard>
  )
}
