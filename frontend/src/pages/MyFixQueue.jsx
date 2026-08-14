import { motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import api from '../api/client'
import SiteHistoryDrawer, { SiteCodeButton } from '../components/SiteHistoryDrawer'
import { EmptyState, Loading, PageHead } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { roleLabel } from '../lib/roles'

/**
 * The entire screen a category owner ever sees.
 *
 * Design constraint that shapes everything here: the people working this
 * queue (power, on-site, MS, planning) do not otherwise live in this
 * platform. So each site shows only what is needed to act — what broke, how
 * late it is, and one button — and a badge appears only when something is
 * wrong. A row that is on track is deliberately quiet.
 */
export default function MyFixQueue() {
  const { user } = useAuth()
  const toast = useToast()
  const [fixes, setFixes] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [note, setNote] = useState('')
  const [rerouteFor, setRerouteFor] = useState(null)
  const [rerouteTo, setRerouteTo] = useState('')
  const [rerouteReason, setRerouteReason] = useState('')
  const [categories, setCategories] = useState([])
  const [history, setHistory] = useState({ id: null, code: null })

  const load = useCallback(() => {
    api
      .get('/hc/my/fixes')
      .then((r) => setFixes(r.data))
      .catch(() => toast.error('Could not load your queue', 'Please refresh.'))
  }, [toast])

  useEffect(() => {
    load()
    api
      .get('/reference/problem-categories')
      .then((r) => setCategories(r.data.map((c) => c.name)))
      .catch(() => setCategories([]))
  }, [load])

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
      load()
    } catch (e) {
      toast.error('Could not send', e?.response?.data?.detail || 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (!fixes) return <Loading label="Loading your queue" />

  const late = fixes.filter((f) => f.days_late > 0).length
  const teamName = roleLabel(user?.role?.name)

  return (
    <>
      <PageHead
        eyebrow={teamName}
        title="My Fix Queue"
        subtitle="Fix the issue, mark it done, and the site goes back for re-check."
      />

      {fixes.length === 0 ? (
        <EmptyState
          title="Nothing waiting on you"
          hint="Sites appear here when a health check fails and a PM routes it to your team."
        />
      ) : (
        <div className="card">
          <div
            className="row wrap"
            style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)' }}
          >
            <b style={{ fontFamily: 'var(--font-display)', fontSize: 14.5 }}>
              {fixes.length} site{fixes.length === 1 ? '' : 's'} waiting on you
            </b>
            {late > 0 && <span className="pill pill-red">{late} late</span>}
          </div>

          {fixes.map((fix, i) => (
            <motion.div
              key={fix.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.2) }}
              style={{
                display: 'grid',
                gridTemplateColumns: '3px 1fr',
                gap: 16,
                padding: '18px 20px',
                borderBottom:
                  i === fixes.length - 1 ? 'none' : '1px solid var(--border-soft)',
              }}
            >
              <div
                style={{
                  borderRadius: 3,
                  background:
                    fix.days_late > 0 ? 'var(--red)' : 'var(--border)',
                }}
              />
              <div>
                <div className="row wrap" style={{ gap: 12, alignItems: 'baseline' }}>
                  <SiteCodeButton
                    workItemId={fix.work_item_id}
                    siteCode={fix.site_code}
                    onOpen={(id, code) => setHistory({ id, code })}
                  />
                  <span className="dim" style={{ fontSize: 13 }}>
                    {fix.province}
                  </span>
                  {fix.round_no > 1 && (
                    <span className="pill pill-dim">Round {fix.round_no}</span>
                  )}
                  <div className="spacer" />
                  <Urgency fix={fix} />
                </div>

                <div className="muted" style={{ fontSize: 13.5, marginTop: 7, maxWidth: '70ch' }}>
                  {fix.technologies.length > 0 && (
                    <b style={{ color: 'var(--text)' }}>
                      {fix.technologies.join(', ')}:{' '}
                    </b>
                  )}
                  {fix.issue || 'No detail was recorded by the field team.'}
                </div>

                {fix.also_waiting_on.length > 0 && (
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 5 }}>
                    Also waiting on {fix.also_waiting_on.join(', ')} — the site
                    returns for re-check when both are done.
                  </div>
                )}

                {fix.reroute_pending ? (
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 14 }}>
                    Waiting for the PM to confirm who this belongs to.
                  </div>
                ) : noteFor === fix.id ? (
                  <div style={{ marginTop: 14, maxWidth: 520 }}>
                    <textarea
                      className="input"
                      rows={2}
                      autoFocus
                      placeholder="What did you do? e.g. Battery bank replaced, runtime now 12h/day"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="row" style={{ gap: 9, marginTop: 9 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busyId === fix.id}
                        onClick={() => closeFix(fix)}
                      >
                        Confirm fixed
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setNoteFor(null)
                          setNote('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : rerouteFor === fix.id ? (
                  <div style={{ marginTop: 14, maxWidth: 520 }}>
                    <select
                      className="input"
                      value={rerouteTo}
                      onChange={(e) => setRerouteTo(e.target.value)}
                      style={{ marginBottom: 9 }}
                    >
                      <option value="">Which team does this belong to?</option>
                      {categories
                        .filter((c) => c !== fix.category)
                        .map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                    </select>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Why is this not your team's work?"
                      value={rerouteReason}
                      onChange={(e) => setRerouteReason(e.target.value)}
                    />
                    <div className="row" style={{ gap: 9, marginTop: 9 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busyId === fix.id}
                        onClick={() => proposeReroute(fix)}
                      >
                        Send to PM
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setRerouteFor(null)
                          setRerouteTo('')
                          setRerouteReason('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 14, marginTop: 14 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setNoteFor(fix.id)
                        setRerouteFor(null)
                      }}
                    >
                      Mark fixed
                    </button>
                    <button
                      onClick={() => {
                        setRerouteFor(fix.id)
                        setNoteFor(null)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-dim)',
                        fontSize: 12.5,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Not my area
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </>
  )
}

/** Says something only when the fix is late or nearly due; silence = on track. */
function Urgency({ fix }) {
  if (fix.days_late > 0) {
    return (
      <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>
        {fix.days_late} day{fix.days_late === 1 ? '' : 's'} late
      </span>
    )
  }
  const dueIn = daysUntil(fix.due_at)
  if (dueIn !== null && dueIn <= 2) {
    return (
      <span style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 13 }}>
        {dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
      </span>
    )
  }
  return null
}

function daysUntil(value) {
  if (!value) return null
  const due = new Date(value)
  if (Number.isNaN(due.getTime())) return null
  return Math.max(Math.ceil((due - new Date()) / 86400000), 0)
}
