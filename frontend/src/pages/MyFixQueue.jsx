import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api/client'
import Icon from '../components/Icon'
import SiteHistoryDrawer, { SiteCodeButton } from '../components/SiteHistoryDrawer'
import { useFillPage } from '../components/pageMode'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { roleLabel } from '../lib/roles'
import '../styles/fix-queue.css'
import { formatNumber } from '../lib/numbers'
import Select from '../components/Select'

/**
 * The Fix queue, in the Drive test app: the one page a category owner works.
 *
 * Design constraint that shapes everything here: the people working this
 * queue (power, on-site, MS, planning) do not otherwise live in this
 * platform. So each site shows only what is needed to act — what broke, how
 * late it is, and one button — and red appears only when a site is late.
 * One screen: the list scrolls inside its card, never the page.
 */
export default function MyFixQueue() {
  useFillPage()
  const { user } = useAuth()
  const toast = useToast()
  const [fixes, setFixes] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [note, setNote] = useState('')
  const [rerouteFor, setRerouteFor] = useState(null)
  const [rerouteTo, setRerouteTo] = useState('')
  const [rerouteReason, setRerouteReason] = useState('')
  const [categories, setCategories] = useState([])
  const [history, setHistory] = useState({ id: null, code: null })
  // The button that opened a form; focus goes back to it when the form closes.
  const opener = useRef(null)

  const load = useCallback(() => {
    setFailed(false)
    api
      .get('/hc/my/fixes')
      .then((r) => setFixes(r.data))
      .catch(() => {
        setFailed(true)
        toast.error('Could not load your queue', 'Please refresh.')
      })
  }, [toast])

  useEffect(() => {
    load()
    api
      .get('/reference/problem-categories')
      .then((r) => setCategories(r.data.map((c) => c.name)))
      .catch(() => setCategories([]))
  }, [load])

  const restoreFocus = () => {
    const el = opener.current
    opener.current = null
    if (el) requestAnimationFrame(() => el.isConnected && el.focus())
  }

  const openNote = (fix, e) => {
    opener.current = e.currentTarget
    setNoteFor(fix.id)
    setRerouteFor(null)
  }
  const openReroute = (fix, e) => {
    opener.current = e.currentTarget
    setRerouteFor(fix.id)
    setNoteFor(null)
  }
  const cancelNote = () => {
    setNoteFor(null)
    setNote('')
    restoreFocus()
  }
  const cancelReroute = () => {
    setRerouteFor(null)
    setRerouteTo('')
    setRerouteReason('')
    restoreFocus()
  }

  const closeFix = async (fix) => {
    if (!note.trim()) {
      toast.error('Add a note', 'Say what you did, so the next check has context.')
      return
    }
    setBusyId(fix.id)
    try {
      const r = await api.post(`/hc/fixes/${fix.id}/close`, { note })
      toast.success(
        `${fix.site_code} marked fixed`,
        r.data.returned_to_basket
          ? 'Back in the health check basket for re-check.'
          : `Still waiting on ${fix.also_waiting_on.join(', ')}.`,
      )
      setNoteFor(null)
      setNote('')
      opener.current = null
      load()
    } catch (e) {
      toast.error('Could not save', e?.response?.data?.detail || 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const proposeReroute = async (fix) => {
    if (!rerouteTo || !rerouteReason.trim()) {
      toast.error('Almost there', 'Pick the right team and say why.')
      return
    }
    setBusyId(fix.id)
    try {
      await api.post(`/hc/fixes/${fix.id}/reroute`, {
        to_category: rerouteTo,
        reason: rerouteReason,
      })
      toast.success('Sent to the PM', 'They will confirm who this belongs to.')
      setRerouteFor(null)
      setRerouteTo('')
      setRerouteReason('')
      opener.current = null
      load()
    } catch (e) {
      toast.error('Could not send', e?.response?.data?.detail || 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const loading = fixes === null && !failed
  const late = fixes ? fixes.filter((f) => f.days_late > 0).length : 0

  return (
    <div className="fq-page">
      <header className="fq-title-row">
        <div>
          <h1 className="fq-title">Fix queue</h1>
          <p className="fq-summary" aria-live="polite">
            {loading ? (
              <span className="fq-skel fq-skel-text" aria-hidden="true" />
            ) : fixes && fixes.length > 0 ? (
              <>
                <b>
                  {fixes.length} site{fixes.length === 1 ? '' : 's'}
                </b>{' '}
                waiting on you
                {late > 0 && (
                  <>
                    {' · '}
                    <b className="fq-late">{formatNumber(late)} late</b>
                  </>
                )}
              </>
            ) : fixes ? (
              'Nothing waiting on you'
            ) : null}
          </p>
        </div>
        <span className="fq-team">
          <Icon name="tools" size={16} />
          {roleLabel(user?.role?.name)}
        </span>
      </header>

      <section className="fq-card" aria-label="Sites to fix" aria-busy={loading || undefined}>
        <header className="fq-card-head">
          <span className="fq-tile" aria-hidden="true">
            <Icon name="tools" size={16} />
          </span>
          <h2 className="fq-card-title">Sites to fix</h2>
          <span className="fq-card-sub">Most late first, then longest open</span>
        </header>

        <div className="fq-list">
          {failed ? (
            <div className="fq-state" role="alert">
              <p className="fq-state-title">Couldn&rsquo;t load your queue.</p>
              <button type="button" className="fq-btn fq-btn-secondary" onClick={load}>
                Retry
              </button>
            </div>
          ) : loading ? (
            Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)
          ) : fixes.length === 0 ? (
            <div className="fq-state">
              <span className="fq-tile" aria-hidden="true">
                <Icon name="tools" size={16} />
              </span>
              <p className="fq-state-title">Nothing waiting on you</p>
              <p className="fq-state-hint">
                Sites appear here when a health check fails and a PM routes it to your team.
              </p>
            </div>
          ) : (
            fixes.map((fix, i) => (
              <article
                key={fix.id}
                className="fq-row"
                style={{ '--i': Math.min(i, 6) }}
                aria-label={`${fix.site_code}${fix.days_late > 0 ? `, ${fix.days_late} days late` : ''}`}
              >
                <span className={`fq-bar ${fix.days_late > 0 ? 'is-late' : ''}`.trim()} aria-hidden="true" />
                <div className="fq-main">
                  <div className="fq-top">
                    <SiteCodeButton
                      workItemId={fix.work_item_id}
                      siteCode={fix.site_code}
                      className="fq-code"
                      onOpen={(id, code) => setHistory({ id, code })}
                    />
                    <span className="fq-province" dir="auto">
                      {fix.province}
                    </span>
                    {fix.round_no > 1 && <span className="fq-chip">Round {fix.round_no}</span>}
                  </div>

                  <p className="fq-issue">
                    {fix.technologies.length > 0 && <b>{fix.technologies.join(', ')}: </b>}
                    {fix.issue ? (
                      <span className="fq-farsi" dir="auto">
                        {fix.issue}
                      </span>
                    ) : (
                      'No detail was recorded by the field team.'
                    )}
                  </p>

                  {fix.also_waiting_on.length > 0 && (
                    <p className="fq-also">
                      <Icon name="direction--fork" size={16} />
                      <span>
                        Also waiting on {fix.also_waiting_on.join(', ')} — the site returns for
                        re-check when both are done.
                      </span>
                    </p>
                  )}

                  {fix.reroute_pending ? (
                    <p className="fq-pending">
                      <Icon name="time" size={16} />
                      Waiting for the PM to confirm who this belongs to.
                    </p>
                  ) : noteFor === fix.id ? (
                    <div className="fq-form">
                      <label className="fq-label" htmlFor={`fq-note-${fix.id}`}>
                        What did you do?
                      </label>
                      <textarea
                        id={`fq-note-${fix.id}`}
                        className="fq-input"
                        rows={2}
                        autoFocus
                        placeholder="What did you do? e.g. Battery bank replaced, runtime now 12h/day"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="fq-actions">
                        <button
                          type="button"
                          className="fq-btn fq-btn-primary"
                          disabled={busyId === fix.id}
                          aria-busy={busyId === fix.id || undefined}
                          onClick={() => closeFix(fix)}
                        >
                          <Icon name="checkmark" size={16} />
                          Confirm fixed
                        </button>
                        <button type="button" className="fq-btn fq-btn-secondary" onClick={cancelNote}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : rerouteFor === fix.id ? (
                    <div className="fq-form">
                      <label className="fq-label" htmlFor={`fq-team-${fix.id}`}>
                        Which team does this belong to?
                      </label>
                      <Select
                        id={`fq-team-${fix.id}`}
                        className="fq-input"
                        autoFocus
                        value={rerouteTo}
                        onChange={(e) => setRerouteTo(e.target.value)}
                      >
                        <option value="">Which team does this belong to?</option>
                        {categories
                          .filter((c) => c !== fix.category)
                          .map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                      </Select>
                      <label className="fq-label" htmlFor={`fq-why-${fix.id}`}>
                        Why is this not your team&rsquo;s work?
                      </label>
                      <textarea
                        id={`fq-why-${fix.id}`}
                        className="fq-input"
                        rows={2}
                        placeholder="Why is this not your team's work?"
                        value={rerouteReason}
                        onChange={(e) => setRerouteReason(e.target.value)}
                      />
                      <div className="fq-actions">
                        <button
                          type="button"
                          className="fq-btn fq-btn-primary"
                          disabled={busyId === fix.id}
                          aria-busy={busyId === fix.id || undefined}
                          onClick={() => proposeReroute(fix)}
                        >
                          <Icon name="arrow--right" size={16} />
                          Send to PM
                        </button>
                        <button type="button" className="fq-btn fq-btn-secondary" onClick={cancelReroute}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="fq-actions fq-row-actions">
                      <button type="button" className="fq-btn fq-btn-primary" onClick={(e) => openNote(fix, e)}>
                        <Icon name="checkmark" size={16} />
                        Mark fixed
                      </button>
                      <button type="button" className="fq-text-btn" onClick={(e) => openReroute(fix, e)}>
                        Not my area
                      </button>
                    </div>
                  )}
                </div>
                <Urgency fix={fix} />
              </article>
            ))
          )}
        </div>
      </section>

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="fq-row fq-row-skel" aria-hidden="true">
      <span className="fq-bar" />
      <div className="fq-main">
        <span className="fq-skel" style={{ width: '30%' }} />
        <span className="fq-skel" style={{ width: '70%', marginTop: 10 }} />
        <span className="fq-skel fq-skel-btn" />
      </div>
    </div>
  )
}

/** Says something only when the fix is late or nearly due; silence = on track. */
export function Urgency({ fix }) {
  if (fix.days_late > 0) {
    return (
      <span className="fq-urgency is-late">
        {fix.days_late} day{fix.days_late === 1 ? '' : 's'} late
      </span>
    )
  }
  const dueIn = daysUntil(fix.due_at)
  if (dueIn !== null && dueIn <= 2) {
    return (
      <span className="fq-urgency is-soon">
        {dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
      </span>
    )
  }
  return <span />
}

function daysUntil(value) {
  if (!value) return null
  const due = new Date(value)
  if (Number.isNaN(due.getTime())) return null
  return Math.max(Math.ceil((due - new Date()) / 86400000), 0)
}
