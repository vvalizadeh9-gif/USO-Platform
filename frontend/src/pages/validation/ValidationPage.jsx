import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon'
import LetterDate from '../../components/LetterDate'
import PageFrame from '../../components/PageFrame'
import PageHeader, { HeaderCount } from '../../components/PageHeader'
import Select from '../../components/Select'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import { queueCounts, queueLate } from '../../shell/appRegistry'
import { useHomeData } from '../../shell/HomeData'
import { useDeferredSend } from '../mywork/useDeferredSend'
import { REVIEW_PATH, downloadEvidence, downloadLetterZip, reviewFilings } from './api'
import EvidenceViewer from './EvidenceViewer'
import FilingTable from './FilingTable'
import LetterStrip, { AuthorityBadge } from './LetterStrip'
import ReturnPanel from './ReturnPanel'
import ValidationList from './ValidationList'
import { VIEW_LETTER, VIEW_SITE, useValidation } from './useValidation'
import '../../styles/validation.css'

const HOLD_SECONDS = 6
const otherOf = (authority) => (authority === 'ICT' ? 'CRA' : 'ICT')
const plural = (n, word) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

/** Typing in a field never fires a shortcut. */
function isTyping(target) {
  if (!target || !(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="combobox"]')) {
    return !(target instanceof HTMLInputElement && target.type === 'checkbox')
  }
  return false
}

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Acceptance › ICT validation / CRA validation (UEP-16, preview v9 Option 2).
 *
 * A coordinator or the PM checks contractor filings against their evidence
 * and confirms or returns them in bulk. One authority per page: By letter
 * shows only this one; By site shows the site's other authority beside it,
 * in its own panel, so a whole site can be finished in one sitting -- each
 * panel still sends its own request.
 *
 * Confirm records the contractor's claim as filed, whatever its result;
 * Return sends it back with a reason. Nobody here can change a result.
 */
export default function ValidationPage({ authority }) {
  const { user } = useAuth()
  const toast = useToast()
  const { data: home } = useHomeData()
  const v = useValidation(authority, user?.id)
  const deferred = useDeferredSend()
  const isPm = user?.role?.name === 'PM'
  const other = otherOf(authority)
  const queue = `${authority.toLowerCase()}_to_validate`

  const [selection, setSelection] = useState(() => new Set())
  const [cursorId, setCursorId] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [returning, setReturning] = useState(false)
  const [outside, setOutside] = useState(false)
  const [zipping, setZipping] = useState(null)

  const detail = v.detail
  const mine = useMemo(
    () => (detail?.filings || []).filter((f) => !v.held.has(f.submission_id)),
    [detail, v.held],
  )
  const theirs = useMemo(
    () => (detail?.other?.filings || []).filter((f) => !v.held.has(f.submission_id)),
    [detail, v.held],
  )
  const merged = v.view === VIEW_SITE && detail?.other != null
  const every = useMemo(() => (merged ? [...mine, ...theirs] : mine), [merged, mine, theirs])
  const byId = useMemo(() => new Map(every.map((f) => [f.submission_id, f])), [every])
  const chosen = useMemo(() => every.filter((f) => selection.has(f.submission_id)), [every, selection])

  // A new group starts the selection, the cursor and the panels over.
  useEffect(() => {
    setSelection(new Set())
    setReturning(false)
    setOutside(false)
    setViewer(null)
  }, [v.selectedKey, v.view])
  useEffect(() => {
    if (!every.length) setCursorId(null)
    else if (!byId.has(cursorId)) setCursorId(every[0].submission_id)
  }, [every, byId, cursorId])

  // ------------------------------------------------------------------ select
  const toggle = useCallback((id) => {
    setCursorId(id)
    setSelection((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleAll = useCallback((filings, on) => {
    setSelection((old) => {
      const next = new Set(old)
      for (const f of filings) {
        if (on) next.add(f.submission_id)
        else next.delete(f.submission_id)
      }
      return next
    })
  }, [])
  const clear = useCallback(() => {
    setSelection(new Set())
    setReturning(false)
    setOutside(false)
  }, [])

  // ------------------------------------------------------------------ decide
  const unchecked = chosen.filter((f) => !f.has_evidence)
  const confirmBlocked = chosen.length === 0 || (unchecked.length > 0 && !outside)

  const send = useCallback((decision, reasons = { shared: '', own: {} }) => {
    if (!chosen.length) return
    const groups = [authority, other]
      .map((a) => [a, chosen.filter((f) => f.authority === a)])
      .filter(([, fs]) => fs.length)
    const word = decision === 'confirm' ? 'Confirmed' : 'Returned'
    for (const [a, filings] of groups) {
      const ids = filings.map((f) => f.submission_id)
      const body = {
        authority: a,
        decision,
        items: filings.map((f) => ({
          submission_id: f.submission_id,
          version: f.version,
          ...(decision === 'return' && reasons.own[f.submission_id] ? { reason: reasons.own[f.submission_id] } : {}),
        })),
        ...(decision === 'return' && reasons.shared ? { shared_reason: reasons.shared } : {}),
        ...(decision === 'confirm' && filings.some((f) => !f.has_evidence) ? { evidence_checked_outside: true } : {}),
      }
      v.hold(ids)
      deferred.hold({
        text: `${word} ${plural(filings.length, `${a} filing`)}`,
        path: REVIEW_PATH,
        body,
        run: () => reviewFilings(body),
        onDone: async () => {
          await v.refresh()
          v.release(ids)
        },
        onUndo: () => {
          v.release(ids)
          setSelection((old) => new Set([...old, ...ids]))
        },
        onFail: (err) => {
          v.release(ids)
          const errors = err?.response?.data?.detail?.errors || []
          if (err?.response?.status === 409) {
            const stale = errors.filter((e) => e.code === 'stale')
            const first = stale[0] || {}
            const verb = first.status === 'returned' ? 'returned' : first.status === 'filled' ? 'changed' : 'confirmed'
            toast.info(
              `${formatNumber(stale.length)} ${stale.length === 1 ? 'was' : 'were'} already ${verb}${first.decided_by ? ` by ${first.decided_by}` : ''}${first.decided_at ? ` · ${timeOf(first.decided_at)}` : ''}`,
              'The rest are still selected.',
            )
            const gone = new Set(stale.map((e) => e.submission_id))
            setSelection((old) => new Set([...old, ...ids.filter((id) => !gone.has(id))]))
            v.refresh()
          } else {
            toast.error('Nothing was saved', detailMessage(err, 'The server refused the request.'))
            setSelection((old) => new Set([...old, ...ids]))
          }
        },
      })
    }
    clear()
  }, [chosen, authority, other, deferred, v, toast, clear])

  const confirm = useCallback(() => { if (!confirmBlocked) send('confirm') }, [confirmBlocked, send])
  const openReturn = useCallback(() => { if (chosen.length) setReturning(true) }, [chosen.length])

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const at = every.findIndex((f) => f.submission_id === cursorId)
      if (key === 'j' || key === 'ArrowDown') {
        if (!every.length) return
        e.preventDefault()
        setCursorId(every[Math.min(every.length - 1, at + 1)].submission_id)
      } else if (key === 'k' || key === 'ArrowUp') {
        if (!every.length) return
        e.preventDefault()
        setCursorId(every[Math.max(0, at - 1)].submission_id)
      } else if (key === 'x') {
        if (cursorId != null) { e.preventDefault(); toggle(cursorId) }
      } else if (key === 'c') {
        e.preventDefault()
        confirm()
      } else if (key === 'r') {
        e.preventDefault()
        openReturn()
      } else if (key === 'Escape') {
        if (viewer) setViewer(null)
        else clear()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [every, cursorId, toggle, confirm, openReturn, viewer, clear])

  // ------------------------------------------------------------------ header
  const counts = queueCounts(home)
  const late = queueLate(home)
  const waiting = home ? (counts[queue] ?? 0) : v.list?.counts?.waiting
  const lateCount = home ? (late[queue] ?? 0) : v.list?.counts?.late
  const setFilter = (key, value) => v.setFilters((old) => ({ ...old, [key]: value }))
  const options = (items) => [{ value: '', label: 'All' }, ...items.map((i) => ({ value: String(i.id), label: i.name }))]

  const header = (
    <PageHeader
      title={`${authority} validation`}
      count={waiting != null ? (
        <HeaderCount waiting={waiting} late={lateCount} noun={`${authority} ${waiting === 1 ? 'filing' : 'filings'} waiting`} />
      ) : null}
      filters={(
        <div className="vl-filters">
          <button type="button" className="vl-filter-chip" aria-pressed={v.filters.late} onClick={() => setFilter('late', !v.filters.late)}>
            Late
          </button>
          <button type="button" className="vl-filter-chip" aria-pressed={v.filters.has_rejection} onClick={() => setFilter('has_rejection', !v.filters.has_rejection)}>
            Has rejection
          </button>
          <Select
            className="vl-select"
            aria-label="Contractor"
            value={v.filters.contractor_id}
            onChange={(e) => setFilter('contractor_id', e.target.value)}
            options={options(v.list?.contractors || []).map((o) => (o.value ? o : { ...o, label: 'All contractors' }))}
          />
          {isPm && (
            <>
              <Select
                className="vl-select"
                aria-label="Province"
                value={v.filters.province_id}
                onChange={(e) => setFilter('province_id', e.target.value)}
                options={options(v.list?.provinces || []).map((o) => (o.value ? o : { ...o, label: 'All provinces' }))}
              />
              <Select
                className="vl-select"
                aria-label="CRA region"
                value={v.filters.region_id}
                onChange={(e) => setFilter('region_id', e.target.value)}
                options={options(v.list?.regions || []).map((o) => (o.value ? o : { ...o, label: 'All CRA regions' }))}
              />
            </>
          )}
        </div>
      )}
    />
  )

  // ------------------------------------------------------------------- body
  const empty = v.filtered ? (
    <div className="vl-state">
      <b>Nothing matches these filters</b>
      <button type="button" className="vl-btn" onClick={v.clearFilters}>Clear filters</button>
    </div>
  ) : (
    <div className="vl-state">
      <span className="vl-state-icon"><Icon name="checkmark--outline" size={20} /></span>
      <b>No {authority} filings waiting</b>
    </div>
  )

  if (v.listError && !v.list) {
    return (
      <PageFrame bar={header} className="vl-page">
        <div className="vl-state is-page" role="alert">
          <span className="vl-state-icon is-error"><Icon name="warning--alt" size={20} /></span>
          <b>Couldn't load {authority} validation.</b>
          <span>{v.listError}</span>
          <button type="button" className="vl-btn" onClick={v.loadList}>Retry</button>
        </div>
      </PageFrame>
    )
  }

  const openLetter = (letterNumber, a) => {
    const letter = detail?.letters.find((l) => l.letter_number === letterNumber && l.authority === a)
    if (letter?.evidence?.length) setViewer({ letter, index: 0 })
  }
  const zip = async (letter) => {
    if (letter.evidence.length === 1) {
      downloadEvidence(letter.evidence[0]).catch((err) => toast.error('Download failed', detailMessage(err, '')))
      return
    }
    setZipping(letter.letter_number)
    try {
      await downloadLetterZip(letter.authority, letter.letter_number)
    } catch (err) {
      toast.error('Download failed', detailMessage(err, 'The zip could not be made.'))
    } finally {
      setZipping(null)
    }
  }
  const held = deferred.held[deferred.held.length - 1]

  return (
    <PageFrame bar={header} className="vl-page">
      <div className="vl-body">
        <ValidationList
          authority={authority}
          view={v.view}
          onView={v.setView}
          counts={v.list?.counts}
          groups={v.groups}
          selectedKey={v.selectedKey}
          onSelect={v.select}
          query={v.query}
          onQuery={v.setQuery}
          loading={!v.list}
          empty={empty}
        />
        <div className={`vl-detail ${viewer ? 'has-viewer' : ''}`.trim()}>
          {v.detailError ? (
            <div className="vl-state" role="alert">
              <b>{v.detailError}</b>
              <button type="button" className="vl-btn" onClick={v.refresh}>Retry</button>
            </div>
          ) : !detail ? (
            v.groups.length || !v.list ? <DetailSkeleton /> : null
          ) : (
            <section
              className={`vl-card is-${authority.toLowerCase()}`}
              key={`${v.view}:${v.selectedKey}`}
              aria-label={v.view === VIEW_LETTER ? `Letter ${detail.group.label}` : `Site ${detail.group.label}`}
            >
              <header className="vl-card-head">
                <h2 className="vl-card-title" dir="ltr">{detail.group.label}</h2>
                <p className="vl-card-sub">
                  {v.view === VIEW_LETTER ? (
                    <>
                      Filed by <bdi dir="rtl" lang="fa" className="vl-fa">{detail.group.contractor?.name || '—'}</bdi>
                      {' · letter date '}<LetterDate shamsi={detail.group.letter_date_shamsi} iso={detail.group.letter_date} />
                      {' · waiting '}{plural(detail.group.waiting_days, 'day')}
                    </>
                  ) : (
                    <>
                      <bdi dir="rtl" lang="fa" className="vl-fa">{detail.group.province || '—'}</bdi>
                      {' · filed by '}<bdi dir="rtl" lang="fa" className="vl-fa">{detail.group.contractor?.name || '—'}</bdi>
                      {' · waiting '}{plural(detail.group.waiting_days, 'day')}
                    </>
                  )}
                </p>
              </header>
              <div className={`vl-split ${viewer ? 'is-open' : ''}`.trim()}>
                <div className="vl-work">
                  <div className={`vl-panels ${merged ? 'is-merged' : ''}`.trim()}>
                    <Panel
                      authority={authority}
                      filings={mine}
                      letters={detail.letters.filter((l) => l.authority === authority)}
                      merged={merged}
                      view={v.view}
                      selection={selection}
                      cursorId={cursorId}
                      onToggle={toggle}
                      onToggleAll={toggleAll}
                      viewer={viewer}
                      onView={(letter) => setViewer({ letter, index: 0 })}
                      onDownload={zip}
                      zipping={zipping}
                      onOpenLetter={openLetter}
                    />
                    {merged && (
                      <Panel
                        authority={other}
                        filings={theirs}
                        letters={detail.letters.filter((l) => l.authority === other)}
                        merged
                        isOther
                        view={v.view}
                        selection={selection}
                        cursorId={cursorId}
                        onToggle={toggle}
                        onToggleAll={toggleAll}
                        viewer={viewer}
                        onView={(letter) => setViewer({ letter, index: 0 })}
                        onDownload={zip}
                        zipping={zipping}
                        onOpenLetter={openLetter}
                      />
                    )}
                  </div>
                  <SelectionBar
                    authority={authority}
                    total={every.length}
                    chosen={chosen}
                    merged={merged}
                    slaDays={detail.sla_days}
                    waitingDays={detail.group.waiting_days}
                    unchecked={unchecked.length}
                    outside={outside}
                    onOutside={setOutside}
                    confirmBlocked={confirmBlocked}
                    onConfirm={confirm}
                    onReturn={openReturn}
                    onClear={clear}
                  />
                  {returning && chosen.length > 0 && (
                    <ReturnPanel
                      key={chosen.map((f) => f.submission_id).join(',')}
                      filings={chosen}
                      contractor={detail.group.contractor?.name}
                      onSubmit={(reasons) => send('return', reasons)}
                      onCancel={() => setReturning(false)}
                    />
                  )}
                </div>
                {viewer && (
                  <EvidenceViewer
                    key={`${viewer.letter.authority}:${viewer.letter.letter_number}`}
                    letter={viewer.letter}
                    startAt={viewer.index}
                    onClose={() => setViewer(null)}
                  />
                )}
              </div>
            </section>
          )}
          {held && <HoldToast key={held.id} entry={held} onUndo={deferred.undo} onSendNow={deferred.commit} />}
        </div>
      </div>
    </PageFrame>
  )
}

/** One authority's letters and filings. In the merged site view each panel
 * has its own top edge, header and select-all. */
function Panel({
  authority, filings, letters, merged, isOther = false, view, selection, cursorId,
  onToggle, onToggleAll, viewer, onView, onDownload, zipping, onOpenLetter,
}) {
  return (
    <div className={`vl-panel is-${authority.toLowerCase()} ${merged ? 'is-edged' : ''}`.trim()}>
      {merged && (
        <div className="vl-panel-head">
          <AuthorityBadge authority={authority} />
          <span className="vl-panel-count">{plural(filings.length, 'filing')}</span>
          {isOther && <span className="vl-panel-note">also waiting on this site</span>}
        </div>
      )}
      {letters.map((letter) => (
        <LetterStrip
          key={`${letter.authority}:${letter.letter_number}`}
          letter={letter}
          open={viewer?.letter.letter_number === letter.letter_number && viewer?.letter.authority === letter.authority}
          onView={onView}
          onDownload={onDownload}
          busy={zipping === letter.letter_number}
        />
      ))}
      {filings.length === 0 ? (
        <p className="vl-panel-empty">No {authority} filings waiting on this site</p>
      ) : (
        <FilingTable
          authority={authority}
          filings={filings}
          selected={selection}
          onToggle={onToggle}
          onToggleAll={(on) => onToggleAll(filings, on)}
          cursorId={cursorId}
          column={view === VIEW_SITE ? 'letter' : 'site'}
          onOpenLetter={onOpenLetter}
          label={`${authority} filings`}
        />
      )}
    </div>
  )
}

/** Idle: the group's filings and its SLA. With a selection: what is selected
 * (split by authority on a merged site), Confirm, Return, Clear. */
function SelectionBar({
  authority, total, chosen, merged, slaDays, waitingDays, unchecked, outside, onOutside,
  confirmBlocked, onConfirm, onReturn, onClear,
}) {
  const n = chosen.length
  if (!n) {
    const left = (slaDays ?? 0) - (waitingDays ?? 0)
    return (
      <div className="vl-bar">
        <span>
          {plural(total, 'filing')} · SLA {plural(slaDays ?? 0, 'day')} ·{' '}
          {left >= 0 ? `${plural(left, 'day')} left` : <b className="vl-bad">{plural(-left, 'day')} over</b>}
        </span>
        <span className="vl-hint" aria-hidden="true">
          <kbd>J</kbd> <kbd>K</kbd> move · <kbd>X</kbd> select · <kbd>C</kbd> confirm · <kbd>R</kbd> return
        </span>
      </div>
    )
  }
  const counts = merged
    ? [authority, authority === 'ICT' ? 'CRA' : 'ICT'].map((a) => [a, chosen.filter((f) => f.authority === a).length])
    : []
  const label = !merged && n === total && n > 1 ? `All ${formatNumber(n)} selected` : `${formatNumber(n)} selected`
  return (
    <div className="vl-bar is-active" role="region" aria-label="Selection">
      <span className="vl-bar-count" aria-live="polite">
        <b>{label}</b>
        {merged && counts.map(([a, c]) => <span key={a}> · {formatNumber(c)} {a}</span>)}
      </span>
      {unchecked > 0 && (
        <label className="vl-outside">
          <input type="checkbox" checked={outside} onChange={(e) => onOutside(e.target.checked)} />
          I checked the evidence outside UEP
        </label>
      )}
      <span className="vl-bar-actions">
        <button type="button" className="vl-btn is-primary" onClick={onConfirm} disabled={confirmBlocked} aria-keyshortcuts="C">
          <Icon name="checkmark" size={16} /> Confirm
        </button>
        <button type="button" className="vl-btn is-danger" onClick={onReturn} aria-keyshortcuts="R">
          <Icon name="undo" size={16} /> Return
        </button>
        <button type="button" className="vl-btn is-ghost" onClick={onClear}>Clear</button>
      </span>
    </div>
  )
}

/** "Confirmed 3 ICT filings" with Undo and a 6-second bar. × sends it now. */
function HoldToast({ entry, onUndo, onSendNow }) {
  return (
    <div className="vl-toast" role="status" aria-live="polite">
      <Icon name="checkmark" size={16} />
      <span className="vl-toast-text">{entry.text}</span>
      <button type="button" className="vl-btn is-ghost" onClick={() => onUndo(entry.id)} disabled={entry.sending}>
        <Icon name="undo" size={16} /> Undo
      </button>
      <button type="button" className="ev-icon-btn" aria-label="Send now" onClick={() => onSendNow(entry.id)} disabled={entry.sending}>
        <Icon name="close" size={16} />
      </button>
      <span className="vl-toast-bar" style={{ animationDuration: `${HOLD_SECONDS}s` }} aria-hidden="true" />
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="vl-card vl-skel-card" aria-busy="true" aria-label="Loading">
      <span className="vl-skel is-title" />
      <span className="vl-skel is-short" />
      {Array.from({ length: 8 }, (_, i) => <span key={i} className="vl-skel is-row" />)}
    </div>
  )
}
