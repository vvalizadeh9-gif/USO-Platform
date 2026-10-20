import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import PageHeader from '../../components/PageHeader'
import { useAuth } from '../../context/AuthContext'
import {
  changedRegions, colourOf, conflictText, effectiveOwners, errorText, formatDate, formatWhen,
  historyLine, loadFor, plural,
} from './provinceAssignments'
import '../../styles/home.css'
import '../../styles/province-assignments.css'

const API = '/admin/province-assignments'
const SLIDE = { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }
const SAVED_MS = 2000

/**
 * Admin > Province assignments (UEP-17): each CRA region is given to one
 * coordinator with one click; its provinces follow. Update saves every edited
 * region in one request and it applies across UEP at once. PM and Admin edit;
 * Viewer reads.
 */
export default function ProvinceAssignmentsPage() {
  const { user, isAdmin } = useAuth()
  const canEdit = ['PM', 'Admin'].includes(user?.role?.name)
  const reduced = useReducedMotion()
  const titleRef = useRef(null)
  const historyRef = useRef(null)

  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saved, setSaved] = useState([])

  const load = useCallback(() => {
    setLoadError(false)
    return api.get(API)
      .then((r) => { setData(r.data); return r.data })
      .catch(() => { setLoadError(true); return null })
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.revertId ? 8000 : 6000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!saved.length) return undefined
    const t = setTimeout(() => setSaved([]), SAVED_MS)
    return () => clearTimeout(t)
  }, [saved])

  const regions = useMemo(() => data?.regions ?? [], [data])
  const changed = changedRegions(regions, draft)
  const canUpdate = canEdit && !busy && changed.length > 0

  function assign(region, userId) {
    setDraft((d) => {
      const next = { ...d }
      if (userId === region.coordinator_user_id) delete next[region.name]
      else next[region.name] = userId
      return next
    })
  }

  async function update() {
    if (!canUpdate) return
    setBusy(true)
    try {
      const r = await api.put(API, {
        changes: changed.map((region) => ({
          cra_region: region.name,
          coordinator_user_id: draft[region.name],
          expected_coordinator_user_id: region.coordinator_user_id,
        })),
      })
      setData(r.data)
      setDraft({})
      setSaved(changed.map((region) => region.name))
      setToast({ text: `${plural(changed.length, 'region')} updated across UEP`, revertId: r.data.change_id })
      titleRef.current?.focus()
    } catch (err) {
      if (err?.response?.status === 409) await keepWhatSurvived(err)
      else setToast({ text: `Couldn't update: ${errorText(err)}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  async function keepWhatSurvived(err) {
    const stale = Object.keys(err.response.data?.detail?.stale ?? {})
    const latest = await load()
    const kept = {}
    for (const region of latest?.regions ?? []) {
      const mine = draft[region.name]
      if (mine != null && !stale.includes(region.name) && mine !== region.coordinator_user_id) kept[region.name] = mine
    }
    setDraft(kept)
    setToast({ text: conflictText(Object.keys(kept)), error: true })
  }

  async function revert(changeId) {
    setToast(null)
    try {
      const r = await api.post(`${API}/revert/${changeId}`)
      setData(r.data)
      setDraft({})
      setToast({ text: 'Previous coordinators restored' })
    } catch (err) {
      setToast({ text: `Couldn't revert: ${errorText(err)}`, error: true })
    }
  }

  const closeHistory = useCallback(() => {
    setHistoryOpen(false)
    historyRef.current?.focus()
  }, [])

  const noCoordinators = data && data.coordinators.length === 0

  const header = (
    <PageHeader
      title={<><span className="pa-title-tile" aria-hidden="true"><Icon name="location" size={20} /></span>Province assignments</>}
      count={data && <Meta data={data} />}
      actions={(
        <Actions
          canEdit={canEdit} changed={changed.length} canUpdate={canUpdate} ready={Boolean(data)}
          historyRef={historyRef} onDiscard={() => setDraft({})}
          onHistory={() => setHistoryOpen(true)} onUpdate={update}
        />
      )}
      headingRef={titleRef}
    />
  )

  return (
    <PageFrame bar={header} className="pa-page">
      {loadError && <LoadError onRetry={load} />}
      {!loadError && !data && <Skeleton />}
      {!loadError && noCoordinators && <NoCoordinators isAdmin={isAdmin} />}
      {!loadError && data && !noCoordinators && (
        <AssignmentGrid
          data={data} draft={draft} canEdit={canEdit} saved={saved} reduced={reduced}
          onAssign={assign}
        />
      )}

      <AnimatePresence>
        {historyOpen && <HistoryDrawer onClose={closeHistory} reduced={reduced} />}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className={`pa-toast ${toast.error ? 'is-error' : ''}`.trim()}
            role={toast.error ? 'alert' : 'status'}
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <span>{toast.text}</span>
            {toast.revertId && canEdit && (
              <button type="button" className="pa-link pa-toast-action" onClick={() => revert(toast.revertId)}>
                Revert
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </PageFrame>
  )
}

function Meta({ data }) {
  const last = data.last_change
  const text = `Coordinators by CRA region · ${plural(data.regions.length, 'region')} · ${plural(data.total_provinces, 'province')}`
    + (last ? ` · last change ${formatDate(last.at)} by ${last.by}` : '')
  return <span className="pa-meta" title={text}>{text}</span>
}

function Actions({ canEdit, changed, canUpdate, ready, historyRef, onDiscard, onHistory, onUpdate }) {
  return (
    <div className="pa-actions">
      {canEdit && changed > 0 && (
        <span className="pa-dirty">
          {plural(changed, 'unsaved change')} ·{' '}
          <button type="button" className="pa-link" onClick={onDiscard}>Discard</button>
        </span>
      )}
      {!canEdit && <span className="pa-pill">View only</span>}
      <button ref={historyRef} type="button" className="btn btn-secondary btn-sm" onClick={onHistory} disabled={!ready}>
        History
      </button>
      {canEdit && (
        <button type="button" className="btn btn-primary btn-sm" disabled={!canUpdate} onClick={onUpdate}>
          {changed > 0 ? `Update ${changed}` : 'Update'}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ grid --
function AssignmentGrid({ data, draft, canEdit, saved, reduced, onAssign }) {
  const { regions, coordinators } = data
  const owners = effectiveOwners(regions, draft)
  const load = loadFor(regions, owners)
  const [hoverCol, setHoverCol] = useState(null)
  const cellRefs = useRef({})

  const focusCell = (rowIndex, userId) => cellRefs.current[`${rowIndex}:${userId}`]?.focus()

  function onKeyDown(event, rowIndex, region) {
    const col = coordinators.findIndex((c) => c.user_id === owners[region.name])
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      if (!canEdit) return
      const step = event.key === 'ArrowRight' ? 1 : -1
      const next = nextChoosable(coordinators, col, step)
      if (next == null) return
      onAssign(region, next.user_id)
      focusCell(rowIndex, next.user_id)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const target = rowIndex + (event.key === 'ArrowDown' ? 1 : -1)
      if (target < 0 || target >= regions.length) return
      focusCell(target, owners[regions[target].name] ?? coordinators[0].user_id)
    }
  }

  return (
    <motion.section
      className="hw-card pa-card"
      aria-label="Coordinators by CRA region"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.24 }}
    >
      <div className="pa-scroll">
        <div className="pa-grid" style={{ '--pa-cols': coordinators.length }} onMouseLeave={() => setHoverCol(null)}>
          <HeaderRow coordinators={coordinators} load={load} total={data.total_provinces}
            hoverCol={hoverCol} onHover={setHoverCol} />
          {regions.map((region, rowIndex) => (
            <RegionRow
              key={region.name} region={region} coordinators={coordinators}
              owner={owners[region.name]} canEdit={canEdit} saved={saved.includes(region.name)}
              hoverCol={hoverCol} onHover={setHoverCol} reduced={reduced}
              cellRef={(userId, el) => { cellRefs.current[`${rowIndex}:${userId}`] = el }}
              onAssign={(userId) => onAssign(region, userId)}
              onKeyDown={(e) => onKeyDown(e, rowIndex, region)}
            />
          ))}
        </div>
      </div>
      <Legend canEdit={canEdit} />
    </motion.section>
  )
}

/** The next coordinator in ``step`` direction a region can be given to. */
function nextChoosable(coordinators, from, step) {
  for (let i = from + step; i >= 0 && i < coordinators.length; i += step) {
    if (coordinators[i].linked) return coordinators[i]
  }
  return null
}

function HeaderRow({ coordinators, load, total, hoverCol, onHover }) {
  return (
    <div className="pa-row pa-head-row">
      <div className="pa-region pa-head-region">
        <span className="pa-head-title">CRA region</span>
        <span className="pa-muted">Each region with its fixed provinces</span>
      </div>
      {coordinators.map((c) => {
        const mine = load[c.user_id] ?? { regions: 0, provinces: 0 }
        const colour = colourOf(c)
        return (
          <div
            key={c.user_id}
            className={`pa-col-head ${hoverCol === c.user_id ? 'is-col-hover' : ''}`.trim()}
            onMouseEnter={() => onHover(c.user_id)}
          >
            <span className="pa-avatar" style={{ background: colour }} aria-hidden="true">{c.initials}</span>
            <span className="pa-col-name">{c.name}</span>
            {c.linked ? (
              <span className="pa-col-count">
                <span>{plural(mine.regions, 'region')}</span>
                <span>{plural(mine.provinces, 'province')}</span>
              </span>
            ) : (
              <span className="pa-col-count">Not linked</span>
            )}
            <span className="pa-load" aria-hidden="true">
              <span style={{ width: `${total ? (mine.provinces / total) * 100 : 0}%`, background: colour }} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RegionRow({ region, coordinators, owner, canEdit, saved, hoverCol, onHover, reduced, cellRef, onAssign, onKeyDown }) {
  const edited = owner !== region.coordinator_user_id
  const previous = coordinators.find((c) => c.user_id === region.coordinator_user_id)
  const current = coordinators.find((c) => c.user_id === owner)
  const tabbable = owner ?? coordinators[0]?.user_id
  return (
    <div
      className={`pa-row ${edited ? 'is-edited' : ''}`.trim()}
      role="radiogroup"
      aria-label={`Coordinator for ${region.name}`}
      aria-readonly={canEdit ? undefined : 'true'}
    >
      <div className="pa-region">
        <div className="pa-region-name">
          <span className="pa-region-title">
            {region.name}
            {saved && <Icon name="checkmark" size={16} className="pa-saved" label="Saved" />}
          </span>
          <span className="pa-badge">{plural(region.provinces.length, 'province')}</span>
          {edited && (
            <span className="pa-change">
              {previous?.name ?? region.coordinator_name ?? 'No coordinator'} → {current?.name}
            </span>
          )}
          {!edited && owner == null && (
            <span className="pa-muted pa-unowned">{region.coordinator_name ?? 'No coordinator'} · no account</span>
          )}
        </div>
        <ul className="pa-tags" aria-label={`${region.name} provinces`}>
          {region.provinces.map((p) => <li key={p.fa} className="pa-tag">{p.en}</li>)}
        </ul>
      </div>
      {coordinators.map((c) => (
        <CoordinatorCell
          key={c.user_id} region={region} coordinator={c}
          checked={owner === c.user_id} wasOwner={edited && region.coordinator_user_id === c.user_id}
          tabbable={tabbable === c.user_id} canEdit={canEdit} hover={hoverCol === c.user_id}
          reduced={reduced} cellRef={(el) => cellRef(c.user_id, el)}
          onHover={() => onHover(c.user_id)} onAssign={() => onAssign(c.user_id)} onKeyDown={onKeyDown}
        />
      ))}
    </div>
  )
}

function CoordinatorCell({ region, coordinator, checked, wasOwner, tabbable, canEdit, hover, reduced, cellRef, onHover, onAssign, onKeyDown }) {
  const colour = colourOf(coordinator)
  const choosable = canEdit && coordinator.linked
  const why = coordinator.linked ? undefined : `${coordinator.name}'s account is not linked to a coordinator name. Link it on the KPI mapping page first.`
  return (
    <div className={`pa-cell ${hover ? 'is-col-hover' : ''}`.trim()} onMouseEnter={onHover}>
      <button
        ref={cellRef}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={coordinator.name}
        aria-disabled={choosable ? undefined : 'true'}
        aria-describedby={why ? `pa-why-${coordinator.user_id}` : undefined}
        title={why}
        tabIndex={tabbable ? 0 : -1}
        className={`pa-choice ${canEdit ? '' : 'is-readonly'}`.trim()}
        style={{ '--pa-colour': colour }}
        onClick={() => { if (choosable && !checked) onAssign() }}
        onKeyDown={onKeyDown}
      >
        {wasOwner && <span className="pa-previous" aria-hidden="true" />}
        {checked ? (
          <motion.span
            layoutId={`owner-${region.name}`}
            className="pa-owner"
            aria-hidden="true"
            initial={false}
            animate={{ backgroundColor: colour }}
            transition={reduced ? { duration: 0 } : SLIDE}
          >
            {coordinator.initials}
          </motion.span>
        ) : (
          canEdit && <span className="pa-empty" aria-hidden="true" />
        )}
      </button>
      {why && <span id={`pa-why-${coordinator.user_id}`} className="pa-sr-only">{why}</span>}
    </div>
  )
}

function Legend({ canEdit }) {
  if (!canEdit) {
    return <footer className="pa-legend"><span>You can view assignments. Only PM and Admin can change them.</span></footer>
  }
  return (
    <footer className="pa-legend">
      <span className="pa-legend-items">
        <span><span className="pa-key pa-key-owner" aria-hidden="true" />Coordinator</span>
        <span><span className="pa-key pa-key-previous" aria-hidden="true" />Previous coordinator, until you press Update</span>
        <span><span className="pa-key pa-key-empty" aria-hidden="true" />Click a circle to give the region to that coordinator</span>
      </span>
      <span>← → change coordinator · ↑ ↓ change region</span>
    </footer>
  )
}

// ---------------------------------------------------------------- states --
function Skeleton() {
  return (
    <section className="hw-card pa-card" aria-busy="true" aria-label="Loading province assignments">
      <div className="pa-scroll">
        <div className="pa-grid" style={{ '--pa-cols': 4 }}>
          <div className="pa-row pa-head-row">
            <div className="pa-region"><span className="h-skel pa-pulse" style={{ width: 160, height: 16 }} /></div>
            {[0, 1, 2, 3].map((i) => (
              <div className="pa-col-head" key={i}><span className="h-skel pa-pulse pa-skel-avatar" /></div>
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="pa-row" key={i}>
              <div className="pa-region">
                <span className="h-skel pa-pulse" style={{ width: 120, height: 16 }} />
                <span className="h-skel pa-pulse" style={{ width: '70%', height: 22 }} />
              </div>
              {[0, 1, 2, 3].map((j) => (
                <div className="pa-cell" key={j}><span className="h-skel pa-pulse pa-skel-dot" /></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LoadError({ onRetry }) {
  return (
    <div className="pa-center">
      <div className="hw-card pa-message" role="alert">
        <b>Couldn&apos;t load province assignments</b>
        <p>The server didn&apos;t answer. Nothing was changed. Try again in a moment.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button>
      </div>
    </div>
  )
}

function NoCoordinators({ isAdmin }) {
  return (
    <div className="pa-center">
      <div className="hw-card pa-message">
        <b>No coordinator accounts yet</b>
        {isAdmin
          ? <Link className="pa-link" to="/admin?tab=users">Users &amp; roles</Link>
          : <p>An administrator creates them in Users &amp; roles.</p>}
      </div>
    </div>
  )
}

// --------------------------------------------------------------- history --
function HistoryDrawer({ onClose, reduced }) {
  const [entries, setEntries] = useState(null)
  const [failed, setFailed] = useState(false)
  const closeRef = useRef(null)
  useEffect(() => {
    api.get(`${API}/history?limit=50`).then((r) => setEntries(r.data)).catch(() => setFailed(true))
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <motion.div
        className="pa-scrim" data-testid="history-scrim" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.25 }}
      />
      <motion.aside
        className="pa-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Assignment history"
        initial={reduced ? false : { x: 420 }}
        animate={{ x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: 420 }}
        transition={{ duration: reduced ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
      >
        <header className="pa-drawer-head">
          <h2>History</h2>
          <button ref={closeRef} type="button" className="pa-icon-btn" aria-label="Close history" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="pa-drawer-body">
          {failed && <p className="pa-muted">Couldn&apos;t load history.</p>}
          {!entries && !failed && <p className="pa-muted">Loading…</p>}
          {entries && entries.length === 0 && <p className="pa-muted">No changes yet.</p>}
          {entries && entries.length > 0 && (
            <ol className="pa-timeline">
              {entries.map((e, i) => (
                <li key={e.change_id}>
                  <div className="pa-tl-head">
                    <b>{e.by}</b>
                    <span>{formatWhen(e.at)}</span>
                    {i === 0 && <span className="pa-current">Current</span>}
                  </div>
                  <ul>
                    {e.changes.map((c) => <li key={c.cra_region}>{historyLine(c)}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </motion.aside>
    </>
  )
}
