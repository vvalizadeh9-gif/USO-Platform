import { useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useToast } from '../../context/ToastContext'
import { BandSkeleton, default as DecisionBand } from './DecisionBand'
import { signedNumber } from './history'
import MeasureList, { ListSkeleton } from './MeasureList'
import { Chip, TabState } from './parts'
import {
  BAND_STREAMS,
  BAND_TITLE,
  buildPlans,
  decidedValue,
  initials,
  isChanged,
  monthLabel,
  streamKpi,
} from './planBoard'
import { streamMeta } from './streams'

const CHIP_WORD = { DT: 'DT', ACCEPTANCE: 'Acc', ICT: 'ICT', CRA: 'CRA' }
const CHIP_TONE = { waiting: 'neutral', approved: 'approved', notFiled: 'danger' }

/**
 * Plans: who submitted DT delivery and Acceptance for the planning month, and
 * the PM's decision on each, in place.
 *
 * A KPI bar on top says how many contractors submitted and what the totals
 * become after the decisions on screen. Below it the contractors are listed by
 * what they need (a decision, a plan not filed, decided), and the selected one
 * is two bands: confirm the number as asked, or move it up or down with a
 * comment. Revision requests and ICT/CRA plans are listed too and open the
 * existing decision drawer. A role that cannot decide reads the same page
 * with plain numbers. The server re-checks every decision.
 *
 * There is no Undo: an approved plan is immutable.
 */
export default function PlansTab({ board, planning, runningPeriod, canDecide, internal, initialContractor, onDecided, announce, openDrawer }) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(initialContractor ?? null)
  const [decisions, setDecisions] = useState({})
  const [busy, setBusy] = useState(null)

  if (board.state === 'loading') return <PlansSkeleton />
  if (board.state !== 'ready') {
    if (board.state === 'denied') return <TabState state="denied" what="Plans" />
    return (
      <div className="mp2-state" role="alert">
        Couldn’t load the plans
        <button type="button" className="mp-btn" onClick={board.reload}>
          <Icon name="renew" size={16} /> Try again
        </button>
      </div>
    )
  }

  const plans = buildPlans(board)
  const { groups } = plans
  const everyone = [...groups.decision, ...groups.notFiled, ...groups.decided]
  const selected = everyone.find((c) => c.id === selectedId) ?? groups.decision[0] ?? everyone[0] ?? null

  if (everyone.length === 0 && plans.revisions.length === 0 && plans.other.length === 0) {
    return <div className="mp2-state">No contractors yet</div>
  }

  const chipsOf = (c) => BAND_STREAMS.map((s) => ({ key: s, label: CHIP_WORD[s], tone: CHIP_TONE[c.cells[s].state] }))
  const contractorRows = (list) => list.map((c) => ({ key: String(c.id), name: c.name, chips: chipsOf(c) }))
  const drawerRows = (list, period) =>
    list.map((r) => ({
      key: r.key ?? `rev-${r.planId}`,
      name: r.name,
      chips: [{ key: r.stream, label: CHIP_WORD[r.stream], tone: 'neutral' }],
      onSelect: () => openDrawer({ year: period.year, month: period.month, contractorId: r.contractorId, stream: r.stream, name: r.name }),
    }))

  const listGroups = [
    plans.revisions.length && { key: 'revisions', title: 'Revision requests', icon: 'renew', count: plans.revisions.length, rows: drawerRows(plans.revisions, runningPeriod) },
    groups.decision.length && { key: 'decision', title: 'Needs your decision', icon: 'time', count: groups.decision.length, rows: contractorRows(groups.decision) },
    groups.notFiled.length && { key: 'notFiled', title: 'Not filed', icon: 'warning--alt', count: groups.notFiled.length, rows: contractorRows(groups.notFiled) },
    groups.decided.length && { key: 'decided', title: 'Decided', icon: 'checkmark', count: groups.decided.length, rows: contractorRows(groups.decided) },
    plans.other.length && { key: 'other', title: 'Other streams (ICT, CRA)', icon: 'document', count: plans.other.length, rows: drawerRows(plans.other, planning) },
  ].filter(Boolean)

  const setDecision = (planId, patch) => setDecisions((d) => ({ ...d, [planId]: { ...d[planId], ...patch } }))
  const clearDecision = (planId) =>
    setDecisions((d) => {
      const { [planId]: _gone, ...rest } = d
      return rest
    })

  async function decide(contractor, stream) {
    const cell = contractor.cells[stream]
    const value = decidedValue(cell, decisions)
    const adjusted = value !== cell.asked
    const word = streamMeta(stream).short
    setBusy(cell.planId)
    try {
      if (adjusted) {
        await api.post(`/pip/${cell.planId}/approve-adjusted`, {
          committed_count: value,
          comment: (decisions[cell.planId]?.comment ?? '').trim(),
        })
      } else {
        await api.post(`/pip/${cell.planId}/approve`)
      }
      clearDecision(cell.planId)
      toast.success(`${word} plan approved: ${value}`)
      announce(`${word} plan approved: ${value}`)
      onDecided()
    } catch (err) {
      // The number and the comment stay on screen, with the server's reason.
      toast.error(`Could not approve the ${word} plan`, err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function confirmAll(contractor) {
    const waiting = BAND_STREAMS.filter((s) => contractor.cells[s].state === 'waiting')
    setBusy('all')
    const results = await Promise.allSettled(waiting.map((s) => api.post(`/pip/${contractor.cells[s].planId}/approve`)))
    setBusy(null)
    const failed = waiting.filter((_, i) => results[i].status === 'rejected')
    if (failed.length === 0) {
      toast.success(`${contractor.name}: plans approved as asked`)
      announce(`${contractor.name}: plans approved as asked`)
    } else {
      const detail = results.find((r) => r.status === 'rejected')?.reason?.response?.data?.detail
      toast.error(`Could not approve ${failed.map((s) => streamMeta(s).short).join(', ')} for ${contractor.name}`, detail || 'Please try again.')
    }
    onDecided()
  }

  const anyChanged = selected && BAND_STREAMS.some((s) => isChanged(selected.cells[s], decisions))
  const anyWaiting = selected && BAND_STREAMS.some((s) => selected.cells[s].state === 'waiting')

  return (
    <div className="mp2-page">
      <div className="mp2-kpis">
        {BAND_STREAMS.map((s) => (
          <KpiCard key={s} title={BAND_TITLE[s]} k={streamKpi(plans, s, decisions, internal?.[s])} showInternal={internal != null} />
        ))}
      </div>

      <div className="mp2-split">
        <MeasureList label="Contractors" groups={listGroups} value={selected ? String(selected.id) : ''} onChange={(key) => setSelectedId(Number(key))} />

        {selected ? (
          <section className="mp2-card mp2-detail" aria-label={selected.name} key={selected.id}>
            <header className="mp2-detail-head">
              <span className="mp2-avatar mp-fa" aria-hidden="true">{initials(selected.name)}</span>
              <div className="mp2-detail-who">
                <h2 className="mp-fa">{selected.name}</h2>
                <p>
                  Plans for <span className="mp-fa">{monthLabel(planning)}</span>
                </p>
              </div>
              {canDecide && anyWaiting && !anyChanged && (
                <button type="button" className="mp2-primary" disabled={busy != null} onClick={() => confirmAll(selected)}>
                  Confirm all as asked
                </button>
              )}
            </header>
            <div className="mp2-bands">
              {BAND_STREAMS.map((s) => {
                const cell = selected.cells[s]
                return (
                  <DecisionBand
                    key={s}
                    title={BAND_TITLE[s]}
                    contractor={selected.name}
                    cell={cell}
                    decision={decisions[cell.planId]}
                    canDecide={canDecide}
                    busy={busy === cell.planId || busy === 'all'}
                    onValue={(value) => setDecision(cell.planId, { value })}
                    onComment={(comment) => setDecision(cell.planId, { comment })}
                    onSubmit={() => decide(selected, s)}
                  />
                )
              })}
            </div>
          </section>
        ) : (
          <section className="mp2-card mp2-detail" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}

function PlansSkeleton() {
  return (
    <div className="mp2-page" role="status" aria-label="Loading the plans">
      <div className="mp2-kpis">
        <div className="mp2-card mp2-kpi mp2-skel" />
        <div className="mp2-card mp2-kpi mp2-skel" />
      </div>
      <div className="mp2-split">
        <ListSkeleton />
        <section className="mp2-card mp2-detail">
          <BandSkeleton />
        </section>
      </div>
    </div>
  )
}

/** One stream's numbers: who submitted, asked against the decided total, and the bar. */
function KpiCard({ title, k, showInternal }) {
  const scale = Math.max(k.internal ?? 0, k.after, 1)
  const at = (v) => `${(100 * v) / scale}%`
  const cover =
    k.toCover == null ? null : k.toCover > 0 ? (
      <Chip tone="danger">{k.toCover} to cover</Chip>
    ) : k.toCover === 0 ? (
      <Chip>Covered</Chip>
    ) : (
      <Chip tone="accent">{-k.toCover} over</Chip>
    )
  return (
    <section className="mp2-card mp2-kpi" aria-label={`${title} summary`}>
      <div className="mp2-kpi-top">
        <h2>{title}</h2>
        <span className="mp2-dots" aria-hidden="true">
          {k.dots.map((on, i) => (
            <i key={i} data-on={on || undefined} />
          ))}
        </span>
        <span className="mp2-kpi-text tnum">
          {k.submitted} of {k.total} contractors submitted
        </span>
        <span className="mp2-kpi-chip">{showInternal && cover}</span>
      </div>
      <div className="mp2-kpi-figures">
        <div>
          <span className="mp2-kpi-num mp2-muted tnum">{k.asked}</span>
          <span className="mp2-kpi-label">Asked</span>
        </div>
        <div>
          <span className="mp2-kpi-num tnum">
            {k.after}
            <Chip tone={k.change === 0 ? 'neutral' : 'accent'}>{k.change === 0 ? 'No change' : signedNumber(k.change)}</Chip>
          </span>
          <span className="mp2-kpi-label">After your decisions</span>
        </div>
        {showInternal && (
          <div>
            <span className="mp2-kpi-num mp2-muted tnum">{k.internal ?? '—'}</span>
            <span className="mp2-kpi-label">Internal PIP</span>
          </div>
        )}
      </div>
      <div
        className="mp2-bar"
        role="img"
        aria-label={`${title}: ${k.approved} approved, ${k.waiting} waiting${k.internal != null ? `, of Internal PIP ${k.internal}` : ''}`}
      >
        <i className="mp2-bar-done" style={{ width: at(k.approved) }} />
        <i className="mp2-bar-wait" style={{ left: at(k.approved), width: at(k.waiting) }} />
      </div>
    </section>
  )
}
