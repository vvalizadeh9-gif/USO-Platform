import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { monthProgress, nextPeriod, previousPeriod, shamsiMonthName } from '../../lib/shamsi'
import ContractorHalf, { Fa } from './ContractorHalf'
import {
  ANSWERING,
  CONTRACTOR_STREAMS,
  MAX_COMMITTED,
  pace,
  parseCount,
  planState,
} from './contractorPlan'

const getMy = (year, month, stream) =>
  api.get('/pip/my', { params: { year, month, stream } }).then((r) => r.data)

// Every version of one stream's plan for the month. The contractor is read
// off the session by the server; this screen never names a company.
const getVersions = (year, month, stream) =>
  api
    .get('/pip/revisions', { params: { year, month, stream } })
    .then((r) => r.data)
    .catch(() => null)

/** Update colours: orange for something to do, purple for a revision, red
 * for a plan sent back. The words say the same thing; colour is never the
 * only signal. */
const DOT = { todo: '#C77D00', revision: '#6B4FA0', returned: '#D94141', behind: '#E3A25B' }

/**
 * The contractor's side of the Monthly Plan: their own company, both streams.
 *
 * DT Delivery on the left, Acceptance on the right, the same component with
 * different data (ContractorHalf). The KPI cards and the pace are always the
 * month now running; the plan block is about the month picked, which opens
 * on the planning month (next month) as before.
 *
 * Three words keep their platform meaning: **Assignment** is the sites held
 * in the month, **PIP** is what the PM approved, **Delivered** is what was
 * done. Nothing here names another company or shows MTN's internal target:
 * every call reads the caller's contractor off their session, and the screen
 * renders named fields only, never a payload as it came.
 */
export default function ContractorPlan({ period, onPeriodChange }) {
  const toast = useToast()
  // The toast helper is a new object on every render of its provider, so a
  // toast would re-run the load below and wipe what was typed. Read it
  // through a ref instead of depending on it.
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [data, setData] = useState(null)
  const [denied, setDenied] = useState(false)
  const [counts, setCounts] = useState({ DT: '', ACCEPTANCE: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const { year, month } = period

  const load = useCallback(async () => {
    setDenied(false)
    try {
      const [dt, acc] = await Promise.all([getMy(year, month, 'DT'), getMy(year, month, 'ACCEPTANCE')])
      const selected = { DT: dt, ACCEPTANCE: acc }

      // The running month's own plans, for its PIP version and pace. When the
      // picker is on the running month already, they are the same two.
      const ry = dt.current_month?.shamsi_year
      const rm = dt.current_month?.shamsi_month
      let running = selected
      if (ry && rm && (ry !== year || rm !== month)) {
        const [rdt, racc] = await Promise.all([getMy(ry, rm, 'DT'), getMy(ry, rm, 'ACCEPTANCE')])
        running = { DT: rdt, ACCEPTANCE: racc }
      }
      const [vdt, vacc] = await Promise.all([
        getVersions(year, month, 'DT'),
        getVersions(year, month, 'ACCEPTANCE'),
      ])

      setData({ selected, running, versions: { DT: vdt, ACCEPTANCE: vacc } })
      // The inputs follow the server's numbers on every load, including after
      // a submit: the value on screen should be the value on record.
      setCounts({
        DT: dt.planning?.committed_count == null ? '' : String(dt.planning.committed_count),
        ACCEPTANCE: acc.planning?.committed_count == null ? '' : String(acc.planning.committed_count),
      })
      setErrors({})
    } catch (err) {
      // A staff account reaching this screen, which the route should have
      // prevented -- but the server is what decides.
      if (err.response?.status === 403) setDenied(true)
      else toastRef.current.error('Could not load your plan', 'Please refresh.')
      setData(null)
    }
  }, [year, month])

  useEffect(() => {
    load()
  }, [load])

  if (denied) {
    return (
      <EmptyState
        title="This screen belongs to a contractor account"
        hint="Your account does not act for a contractor, so there is no plan here to fill in."
      />
    )
  }

  const runningPeriod = data && {
    year: data.selected.DT.current_month.shamsi_year,
    month: data.selected.DT.current_month.shamsi_month,
  }
  const when = !runningPeriod
    ? 'running'
    : year * 12 + month < runningPeriod.year * 12 + runningPeriod.month
      ? 'past'
      : year === runningPeriod.year && month === runningPeriod.month
        ? 'running'
        : 'future'

  const open = data
    ? CONTRACTOR_STREAMS.filter((s) => planState(data.selected[s.key].planning) === 'edit')
    : []

  async function submit() {
    const found = {}
    for (const s of open) {
      const value = parseCount(counts[s.key])
      if (value === undefined) found[s.key] = `A whole number between 0 and ${MAX_COMMITTED}.`
      else if (value === null) found[s.key] = `Enter the ${s.unit} you commit to.`
    }
    setErrors(found)
    const bad = open.filter((s) => found[s.key])
    if (bad.length) {
      // Both numbers go in together, so one bad number holds both back.
      toast.error(
        `Check your ${bad.map((s) => s.name).join(' and ')} PIP`,
        'Nothing was handed in. Both numbers are submitted together.',
      )
      return
    }
    setBusy(true)
    const done = []
    const failed = []
    // Two plans on the server, one call per stream, so a failure can be named.
    for (const s of open) {
      try {
        await api.post('/pip/my', {
          year, month, stream: s.key, committed_count: parseCount(counts[s.key]), submit: true,
        })
        done.push(s.name)
      } catch (err) {
        failed.push(`${s.name}: ${err.response?.data?.detail || 'please try again'}`)
      }
    }
    setBusy(false)
    const label = data.selected.DT.planning.label
    if (failed.length === 0) {
      toast.success('Handed in', `Your ${label} ${done.join(' and ')} PIP ${done.length > 1 ? 'are' : 'is'} with the PM.`)
    } else {
      toast.error(
        done.length ? `Only your ${done.join(' and ')} PIP was handed in` : 'Could not submit',
        failed.join(' · '),
      )
    }
    load()
  }

  const company =
    data?.versions.DT?.contractor_name || data?.versions.ACCEPTANCE?.contractor_name || null
  const progress = runningPeriod ? monthProgress(runningPeriod.year, runningPeriod.month) : null
  const revisionOpen = data?.running.DT.planning.revision_open

  return (
    <div className="cp-page">
      <header className="cp-head">
        <div className="cp-head-left">
          <h1 className="cp-title">Monthly Plan</h1>
          {company && <span className="cp-company">{company}</span>}
        </div>
        <div className="cp-picker">
          <div className="cp-picker-row">
            <button
              type="button"
              className="btn btn-ghost cp-arrow"
              aria-label="Previous month"
              onClick={() => onPeriodChange(previousPeriod(year, month))}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="cp-picker-label" data-testid="cp-period" dir="rtl" lang="fa">
              {shamsiMonthName(month)} {year}
            </span>
            <button
              type="button"
              className="btn btn-ghost cp-arrow"
              aria-label="Next month"
              onClick={() => onPeriodChange(nextPeriod(year, month))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {data && (
            <div className="cp-caption">
              {progress && <>Day {progress.elapsed} of {progress.total} · </>}
              {revisionOpen ? 'revisions until day 15' : 'revisions closed'}
            </div>
          )}
        </div>
      </header>

      {!data ? (
        <Loading label="Loading your plan" />
      ) : (
        <>
          <Updates data={data} />

          <div className="cp-halves">
            {CONTRACTOR_STREAMS.map((s) => (
              <ContractorHalf
                key={s.key}
                stream={s}
                selected={data.selected[s.key]}
                running={data.running[s.key]}
                versions={data.versions[s.key]}
                when={when}
                value={counts[s.key]}
                error={errors[s.key]}
                busy={busy}
                onChange={(v) => {
                  setCounts((c) => ({ ...c, [s.key]: v }))
                  setErrors((e) => ({ ...e, [s.key]: undefined }))
                }}
                onChanged={load}
              />
            ))}
          </div>

          {open.length > 0 && (
            <div className="cp-submit">
              <button type="button" className="btn btn-primary cp-btn-lg" disabled={busy} onClick={submit}>
                {open.some((s) => ANSWERING.includes(data.selected[s.key].planning.status)) ? 'Resubmit' : 'Submit'}
              </button>
              <span className="cp-caption">
                {open.length === CONTRACTOR_STREAMS.length
                  ? 'Hands in your DT and Acceptance PIP together. The PM decides each one.'
                  : `Hands in your ${open[0].name} PIP; the other is not open to edit.`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** What needs this contractor's attention, one pill each. Hidden when there
 * is nothing: an empty strip is not news. */
function Updates({ data }) {
  const items = []
  for (const s of CONTRACTOR_STREAMS) {
    const p = data.selected[s.key].planning
    const state = planState(p)
    if (state === 'missed') {
      items.push({ key: `${s.key}-missed`, dot: DOT.todo, text: <>{s.name}: <Fa>{p.label}</Fa> plan not submitted — deadline passed</> })
    } else if (state === 'edit' && ANSWERING.includes(p.status)) {
      items.push({
        key: `${s.key}-returned`,
        dot: DOT.returned,
        text: <>{s.name}: returned by {p.returned_by || 'the PM'}{p.return_comment ? <> — “<bdi>{p.return_comment}</bdi>”</> : null}</>,
      })
    } else if (state === 'edit') {
      items.push({
        key: `${s.key}-todo`,
        dot: DOT.todo,
        text: <>{s.name}: <Fa>{p.label}</Fa> plan not submitted · due {p.deadline_shamsi}</>,
      })
    }

    const r = data.running[s.key]
    if (r.planning.status === 'RevisionRequested') {
      items.push({
        key: `${s.key}-revision`,
        dot: DOT.revision,
        text: <>{s.name}: revision {r.planning.in_force_count}→{r.planning.committed_count} waiting for PM</>,
      })
    }
    const standing = pace(r.current_month)
    if (standing && standing.diff < 0) {
      items.push({
        key: `${s.key}-behind`,
        dot: DOT.behind,
        text: <>{s.name}: {-standing.diff} behind today’s target</>,
      })
    }
  }
  if (items.length === 0) return null
  return (
    <ul className="cp-updates" aria-label="Updates">
      {items.map((i) => (
        <li key={i.key} className="cp-update">
          <i style={{ background: i.dot }} aria-hidden="true" />
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  )
}
