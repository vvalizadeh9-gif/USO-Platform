import { useCallback, useEffect, useMemo, useState } from 'react'
import PageFrame from '../../components/PageFrame'
import { AuthorityChip, Banner, Loading, PageBar, Tabs } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { fetchSuggestions } from './api'
import { ManyAuthorityCard, SingleAuthorityCard } from './AuthorityCard'
import { RequestedMany, RequestedOne } from './RequestedCard'
import { AUTHORITIES, VIEW_STAFF, tabLabel } from './status'
import UndoToast from './UndoToast'
import VillageList from './VillageList'
import { useDeferredSend } from './useDeferredSend'
import { useFilingForms } from './useFilingForms'
import { useLetterActions } from './useLetterActions'
import { useMyWork } from './useMyWork'

const DECIDING_ROLES = ['Coordinator', 'PM']

/**
 * Acceptance → My Work: every village whose ICT or CRA letter still needs
 * someone, and the one thing to do about it.
 *
 * Left, the village list (the only thing that scrolls). Right, what CPM
 * requested for the focused village, then its ICT and CRA side by side --
 * each filed, sent and checked on its own. Ticking two or more villages turns
 * the right side into one letter for all of them.
 *
 * The server decides every rule; this page draws what it is told
 * (docs/design/my-work-api.md).
 */
export default function MyWork() {
  const { user } = useAuth()
  const toast = useToast()
  const decides = DECIDING_ROLES.includes(user?.role?.name)
  const mw = useMyWork()
  const [forms, formActions] = useFilingForms()
  const deferred = useDeferredSend()
  const letters = useLetterActions({ decides, forms, actions: formActions, deferred, refresh: mw.refresh, toast })

  const view = mw.list?.view || (user?.role?.name === 'Contractor' ? 'contractor' : VIEW_STAFF)
  const readOnly = Boolean(mw.list?.read_only)
  const sendWord = decides ? 'Save' : 'Send'

  // A new selection starts the per-village answers over; the letter stays.
  const selectionKey = `${mw.focusId}|${mw.ticked.join(',')}`
  useEffect(() => { formActions.newSelection() }, [selectionKey, formActions])

  const heldFor = useCallback((villageId, authority) => {
    for (let i = deferred.held.length - 1; i >= 0; i -= 1) {
      const overlay = deferred.held[i].overlay
      if (overlay?.authority === authority && overlay.sides[villageId]) return overlay.sides[villageId]
    }
    return null
  }, [deferred.held])
  const statusFor = useCallback(
    (row, authority) => heldFor(row.village_id, authority)?.status || row.sides[authority].status,
    [heldFor],
  )

  const suggestion = useSuggestion(mw, readOnly)

  const tabs = (mw.list?.tabs || []).map((t) => ({ key: t.key, label: tabLabel(t.key, view), count: t.count }))
  const firstTab = mw.list?.tabs?.[0]?.key

  const bar = (
    <PageBar
      eyebrow="Acceptance"
      title="My Work"
      context={mw.list && <AuthorityTotals totals={mw.list.authority_totals} />}
      tabs={tabs.length > 0 && <Tabs label="Show villages" tabs={tabs} value={mw.tab} onChange={mw.setTab} />}
    />
  )

  return (
    <PageFrame bar={bar} className="mw-page">
      <div className="mw-body">
        <VillageList
          view={view}
          rows={mw.rows}
          total={mw.paste ? mw.rows.length : (mw.list?.total ?? 0)}
          sort={mw.sort}
          onSort={mw.setSort}
          query={mw.query}
          onQuery={mw.setQuery}
          paste={mw.paste}
          onTickPasted={() => mw.tick(mw.paste.ids)}
          focusId={mw.focusId}
          ticked={mw.ticked}
          onFocus={mw.focus}
          onTick={mw.toggleTick}
          onTickAll={(all) => (all ? mw.clearTicks() : mw.tick(mw.rows.map((r) => r.village_id)))}
          statusFor={statusFor}
          hasMore={Boolean(mw.list?.next_cursor)}
          onMore={mw.loadMore}
          emptyHint={mw.query ? 'Nothing matches' : 'Nothing here'}
          resetLabel={view === VIEW_STAFF ? 'Show to check' : 'Show your move'}
          onReset={() => { mw.setQuery(''); if (firstTab) mw.setTab(firstTab) }}
          error={mw.listError}
        />
        <div className="mw-work">
          {mw.multi ? (
            <MultiPane
              mw={mw} decides={decides} readOnly={readOnly} forms={forms} formActions={formActions}
              letters={letters} heldFor={heldFor} sendWord={sendWord}
            />
          ) : (
            <SinglePane
              mw={mw} view={view} decides={decides} forms={forms} formActions={formActions}
              letters={letters} heldFor={heldFor} sendWord={sendWord} suggestion={suggestion}
            />
          )}
          <UndoToast
            entry={deferred.held[deferred.held.length - 1]}
            onUndo={deferred.undo}
            onSendNow={deferred.commit}
          />
        </div>
      </div>
    </PageFrame>
  )
}

/** "ICT 9 not approved · CRA 9 not approved", or "… to check". */
function AuthorityTotals({ totals }) {
  const words = totals.kind === 'to_check' ? 'to check' : 'not approved'
  return (
    <div className="mw-totals">
      {AUTHORITIES.map((authority) => (
        <span key={authority} className="mw-total">
          <AuthorityChip authority={authority} />
          <span><strong className="tnum">{totals[authority]}</strong> {words}</span>
        </span>
      ))}
    </div>
  )
}

/** Same-site villages still waiting on the focused village's first open side. */
function useSuggestion(mw, readOnly) {
  const [suggestion, setSuggestion] = useState(null)
  const detail = mw.detail
  const authority = detail && AUTHORITIES.find((a) => detail.sides[a].editable)
  useEffect(() => {
    setSuggestion(null)
    if (!detail || !authority || readOnly) return undefined
    let live = true
    fetchSuggestions(detail.village_id, authority, mw.scope)
      .then((data) => { if (live) setSuggestion(data) })
      .catch(() => {})
    return () => { live = false }
  }, [detail, authority, readOnly, mw.scope])
  return suggestion
}

function SinglePane({ mw, view, decides, forms, formActions, letters, heldFor, sendWord, suggestion }) {
  const detail = mw.detail
  if (mw.detailError) return <Banner tone="error">{mw.detailError}</Banner>
  if (!detail) return mw.rows.length ? <Loading label="Loading village" /> : null
  return (
    <>
      <RequestedOne
        facts={detail.facts}
        suggestion={suggestion}
        onTakeSuggestion={() => mw.tick([detail.village_id, ...suggestion.villages.map((v) => v.village_id)])}
        onPrev={() => mw.step(-1)}
        onNext={() => mw.step(1)}
      />
      <div className="mw-cards">
        {AUTHORITIES.map((authority) => (
          <SingleAuthorityCard
            key={authority}
            authority={authority}
            view={view}
            decides={decides}
            detail={detail}
            side={detail.sides[authority]}
            held={heldFor(detail.village_id, authority)}
            form={forms[authority]}
            actions={formActions}
            letters={letters}
            sendLabel={`${sendWord} ${authority}`}
          />
        ))}
      </div>
    </>
  )
}

function MultiPane({ mw, decides, readOnly, forms, formActions, letters, heldFor, sendWord }) {
  const rows = mw.tickedRows
  const ids = useMemo(() => rows.map((r) => r.village_id), [rows])
  return (
    <>
      <RequestedMany
        rows={rows}
        onUntick={(id) => mw.tick(ids.filter((x) => x !== id))}
        onClear={mw.clearTicks}
      />
      <div className="mw-cards">
        {AUTHORITIES.map((authority) => (
          <ManyAuthorityCard
            key={authority}
            authority={authority}
            decides={decides}
            readOnly={readOnly}
            rows={rows}
            heldFor={(id) => heldFor(id, authority)}
            form={forms[authority]}
            actions={formActions}
            letters={letters}
            sendLabel={`${sendWord} ${authority}`}
          />
        ))}
      </div>
    </>
  )
}
